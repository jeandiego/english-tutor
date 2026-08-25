use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::tutor::{BetterExpression, CorrectionCategory, CorrectionSeverity, TutorCorrection};

const DB_FILE_NAME: &str = "history.sqlite3";
const SCHEMA_VERSION: i32 = 1;
const LEARNER_CONTEXT_RECENT_CORRECTIONS: i64 = 50;
const LEARNER_CONTEXT_MIN_COUNT: i64 = 2;
const LEARNER_CONTEXT_MAX_CATEGORIES: usize = 2;
const ALL_TIME_CATEGORY_LIMIT: i64 = 100_000;
const DEFAULT_LIST_LIMIT: i64 = 10;
const MAX_LIST_LIMIT: i64 = 100;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl HistoryCommandError {
    fn new(
        code: &'static str,
        message: impl Into<String>,
        technical_message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: technical_message.into(),
        }
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl From<rusqlite::Error> for HistoryCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::new(
            "history-storage-failed",
            "The learning history could not be saved.",
            error.to_string(),
        )
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionStart {
    session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    learner_context: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    id: i64,
    started_at: i64,
    ended_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
    turn_count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    category: String,
    count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpressionSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    original: Option<String>,
    suggestion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    explanation: Option<String>,
    timestamp: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn category_str(category: CorrectionCategory) -> &'static str {
    match category {
        CorrectionCategory::Grammar => "grammar",
        CorrectionCategory::Vocabulary => "vocabulary",
        CorrectionCategory::Naturalness => "naturalness",
        CorrectionCategory::Clarity => "clarity",
    }
}

fn severity_str(severity: CorrectionSeverity) -> &'static str {
    match severity {
        CorrectionSeverity::Minor => "minor",
        CorrectionSeverity::Important => "important",
    }
}

fn category_label(category: &str) -> &str {
    match category {
        "grammar" => "grammar",
        "vocabulary" => "vocabulary choices",
        "naturalness" => "natural phrasing",
        "clarity" => "clarity",
        other => other,
    }
}

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, HistoryCommandError> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(DB_FILE_NAME))
        .map_err(|error| {
            HistoryCommandError::new(
                "history-location-unavailable",
                "The learning history location is unavailable.",
                error.to_string(),
            )
        })
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL,
            mode TEXT,
            topic TEXT
        );
        CREATE TABLE IF NOT EXISTS turn (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_turn_session ON turn(session_id, timestamp);

        CREATE TABLE IF NOT EXISTS correction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
            original TEXT NOT NULL,
            correction TEXT NOT NULL,
            explanation TEXT NOT NULL,
            category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
            severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
        );
        CREATE INDEX IF NOT EXISTS idx_correction_turn ON correction(turn_id);
        CREATE INDEX IF NOT EXISTS idx_correction_category ON correction(category);

        CREATE TABLE IF NOT EXISTS expression (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
            original TEXT,
            suggestion TEXT NOT NULL,
            explanation TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_expression_turn ON expression(turn_id);",
    )?;

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn open_connection(path: &Path) -> Result<Connection, HistoryCommandError> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory).map_err(|error| {
            HistoryCommandError::new(
                "history-storage-failed",
                "The learning history directory could not be created.",
                error.to_string(),
            )
        })?;
    }

    let conn = Connection::open(path).map_err(|error| {
        HistoryCommandError::new(
            "history-storage-failed",
            "The learning history database could not be opened.",
            error.to_string(),
        )
    })?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;

    migrate(&conn)?;

    Ok(conn)
}

fn create_session(conn: &Connection, started_at_ms: i64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO session (started_at, ended_at) VALUES (?1, ?1)",
        params![started_at_ms],
    )?;
    Ok(conn.last_insert_rowid())
}

fn record_turn_pair(
    conn: &mut Connection,
    session_id: i64,
    transcript: &str,
    reply: &str,
    corrections: &[TutorCorrection],
    expressions: &[BetterExpression],
    now_ms: i64,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO turn (session_id, role, text, timestamp) VALUES (?1, 'user', ?2, ?3)",
        params![session_id, transcript, now_ms],
    )?;
    let user_turn_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO turn (session_id, role, text, timestamp) VALUES (?1, 'assistant', ?2, ?3)",
        params![session_id, reply, now_ms],
    )?;
    let assistant_turn_id = tx.last_insert_rowid();

    for correction in corrections {
        tx.execute(
            "INSERT INTO correction (turn_id, original, correction, explanation, category, severity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                user_turn_id,
                &correction.original,
                &correction.correction,
                &correction.explanation,
                category_str(correction.category),
                severity_str(correction.severity),
            ],
        )?;
    }

    for expression in expressions {
        tx.execute(
            "INSERT INTO expression (turn_id, original, suggestion, explanation)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                assistant_turn_id,
                &expression.original,
                &expression.suggestion,
                &expression.explanation,
            ],
        )?;
    }

    tx.execute(
        "UPDATE session SET ended_at = ?1 WHERE id = ?2",
        params![now_ms, session_id],
    )?;

    tx.commit()
}

fn recent_sessions(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT s.id, s.started_at, s.ended_at, s.mode, s.topic,
                (SELECT COUNT(*) FROM turn t WHERE t.session_id = s.id AND t.role = 'user') AS turn_count
         FROM session s
         ORDER BY s.started_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok(SessionSummary {
            id: row.get(0)?,
            started_at: row.get(1)?,
            ended_at: row.get(2)?,
            mode: row.get(3)?,
            topic: row.get(4)?,
            turn_count: row.get(5)?,
        })
    })?;
    rows.collect()
}

fn category_counts(conn: &Connection, recent_limit: i64) -> rusqlite::Result<Vec<CategoryCount>> {
    let mut statement = conn.prepare(
        "SELECT category, COUNT(*) as count FROM (
            SELECT c.category FROM correction c
            JOIN turn t ON t.id = c.turn_id
            ORDER BY t.timestamp DESC
            LIMIT ?1
         )
         GROUP BY category
         ORDER BY count DESC, category ASC",
    )?;
    let rows = statement.query_map(params![recent_limit], |row| {
        Ok(CategoryCount {
            category: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn recent_expressions(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ExpressionSummary>> {
    let mut statement = conn.prepare(
        "SELECT e.original, e.suggestion, e.explanation, t.timestamp
         FROM expression e
         JOIN turn t ON t.id = e.turn_id
         ORDER BY t.timestamp DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok(ExpressionSummary {
            original: row.get(0)?,
            suggestion: row.get(1)?,
            explanation: row.get(2)?,
            timestamp: row.get(3)?,
        })
    })?;
    rows.collect()
}

fn learner_context_summary(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let counts = category_counts(conn, LEARNER_CONTEXT_RECENT_CORRECTIONS)?;
    let labels: Vec<&str> = counts
        .iter()
        .filter(|entry| entry.count >= LEARNER_CONTEXT_MIN_COUNT)
        .take(LEARNER_CONTEXT_MAX_CATEGORIES)
        .map(|entry| category_label(&entry.category))
        .collect();

    if labels.is_empty() {
        return Ok(None);
    }

    let joined = labels.join(" and ");
    Ok(Some(format!(
        "The learner has recently repeated mistakes involving {joined}. \
         Do not drill these explicitly. When natural, create conversation opportunities \
         where these structures may come up."
    )))
}

fn clamp_limit(limit: Option<u32>) -> i64 {
    limit
        .map(|value| value as i64)
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT)
}

async fn run_blocking<T, F>(task: F) -> Result<T, HistoryCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, HistoryCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            HistoryCommandError::new(
                "history-task-failed",
                "The learning history request could not complete.",
                error.to_string(),
            )
        })?
}

pub(crate) async fn persist_turn(
    app_handle: &AppHandle,
    session_id: i64,
    transcript: String,
    reply: String,
    corrections: Vec<TutorCorrection>,
    expressions: Vec<BetterExpression>,
) -> Result<(), HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let mut conn = open_connection(&path)?;
        record_turn_pair(
            &mut conn,
            session_id,
            &transcript,
            &reply,
            &corrections,
            &expressions,
            now_ms(),
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn start_session(app_handle: AppHandle) -> Result<SessionStart, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        let session_id = create_session(&conn, now_ms())?;
        let learner_context = learner_context_summary(&conn)?;
        Ok(SessionStart {
            session_id,
            learner_context,
        })
    })
    .await
}

#[tauri::command]
pub async fn list_recent_sessions(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<SessionSummary>, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    let limit = clamp_limit(limit);
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(recent_sessions(&conn, limit)?)
    })
    .await
}

#[tauri::command]
pub async fn list_correction_category_counts(
    app_handle: AppHandle,
) -> Result<Vec<CategoryCount>, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(category_counts(&conn, ALL_TIME_CATEGORY_LIMIT)?)
    })
    .await
}

#[tauri::command]
pub async fn list_recent_expressions(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<ExpressionSummary>, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    let limit = clamp_limit(limit);
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(recent_expressions(&conn, limit)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn scratch_db() -> (TempDir, PathBuf) {
        let directory = TempDir::new().expect("tempdir must exist");
        let path = directory.path().join("history.sqlite3");
        (directory, path)
    }

    fn correction(category: CorrectionCategory, severity: CorrectionSeverity) -> TutorCorrection {
        TutorCorrection {
            original: "since many years".into(),
            correction: "for many years".into(),
            explanation: "Use for with a duration.".into(),
            category,
            severity,
        }
    }

    fn expression(suggestion: &str) -> BetterExpression {
        BetterExpression {
            original: Some("I am agree".into()),
            suggestion: suggestion.into(),
            explanation: Some("More natural phrasing.".into()),
        }
    }

    #[test]
    fn migration_is_idempotent_and_sets_user_version() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);
        drop(conn);

        let conn = open_connection(&path).expect("connection must reopen");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn record_turn_pair_links_corrections_to_user_turn_and_expressions_to_assistant_turn() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000).expect("session must create");

        record_turn_pair(
            &mut conn,
            session_id,
            "since many years I am agree",
            "That's a good point. How long have you worked there?",
            &[correction(CorrectionCategory::Grammar, CorrectionSeverity::Important)],
            &[expression("I agree.")],
            2_000,
        )
        .expect("turn pair must record");

        let user_turn_id: i64 = conn
            .query_row(
                "SELECT id FROM turn WHERE session_id = ?1 AND role = 'user'",
                params![session_id],
                |row| row.get(0),
            )
            .expect("user turn must exist");
        let assistant_turn_id: i64 = conn
            .query_row(
                "SELECT id FROM turn WHERE session_id = ?1 AND role = 'assistant'",
                params![session_id],
                |row| row.get(0),
            )
            .expect("assistant turn must exist");

        let correction_turn_id: i64 = conn
            .query_row("SELECT turn_id FROM correction LIMIT 1", [], |row| {
                row.get(0)
            })
            .expect("correction must exist");
        assert_eq!(correction_turn_id, user_turn_id);

        let expression_turn_id: i64 = conn
            .query_row("SELECT turn_id FROM expression LIMIT 1", [], |row| {
                row.get(0)
            })
            .expect("expression must exist");
        assert_eq!(expression_turn_id, assistant_turn_id);

        let ended_at: i64 = conn
            .query_row(
                "SELECT ended_at FROM session WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("session must exist");
        assert_eq!(ended_at, 2_000);
    }

    #[test]
    fn category_counts_and_learner_context_apply_minimum_threshold() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000).expect("session must create");

        record_turn_pair(
            &mut conn,
            session_id,
            "text",
            "reply",
            &[
                correction(CorrectionCategory::Grammar, CorrectionSeverity::Important),
                correction(CorrectionCategory::Grammar, CorrectionSeverity::Minor),
                correction(CorrectionCategory::Clarity, CorrectionSeverity::Minor),
            ],
            &[],
            2_000,
        )
        .expect("turn pair must record");

        let counts = category_counts(&conn, LEARNER_CONTEXT_RECENT_CORRECTIONS)
            .expect("counts must compute");
        assert_eq!(counts[0].category, "grammar");
        assert_eq!(counts[0].count, 2);

        let summary = learner_context_summary(&conn)
            .expect("summary must compute")
            .expect("summary must be present when a category repeats");
        assert!(summary.contains("grammar"));
        assert!(!summary.contains("clarity"));
    }

    #[test]
    fn learner_context_is_none_when_no_category_repeats() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000).expect("session must create");

        record_turn_pair(
            &mut conn,
            session_id,
            "text",
            "reply",
            &[correction(CorrectionCategory::Grammar, CorrectionSeverity::Important)],
            &[],
            2_000,
        )
        .expect("turn pair must record");

        assert_eq!(
            learner_context_summary(&conn).expect("summary must compute"),
            None
        );
    }

    #[test]
    fn recent_sessions_reports_user_turn_count_and_touched_ended_at() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000).expect("session must create");
        record_turn_pair(&mut conn, session_id, "a", "b", &[], &[], 2_000)
            .expect("first turn must record");
        record_turn_pair(&mut conn, session_id, "c", "d", &[], &[], 3_000)
            .expect("second turn must record");

        let sessions = recent_sessions(&conn, 10).expect("sessions must list");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].turn_count, 2);
        assert_eq!(sessions[0].ended_at, 3_000);
    }
}
