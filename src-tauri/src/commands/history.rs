use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::assessment::{cefr_level_str, competency_label, AssessmentCompetency, CefrLevel};
use super::tutor::{BetterExpression, CorrectionCategory, CorrectionSeverity, TutorCorrection};

const DB_FILE_NAME: &str = "history.sqlite3";
const SCHEMA_VERSION: i32 = 2;
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

    pub(crate) fn into_parts(self) -> (&'static str, String, String) {
        (self.code, self.message, self.technical_message)
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

    if current_version < 1 {
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
    }

    if current_version < 2 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS assessment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                blueprint_version TEXT NOT NULL,
                rubric_version TEXT NOT NULL,
                estimated_level TEXT CHECK (estimated_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                confidence REAL
            );
            CREATE INDEX IF NOT EXISTS idx_assessment_started_at ON assessment(started_at);

            CREATE TABLE IF NOT EXISTS assessment_task_run (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
                task_id TEXT NOT NULL,
                target_cefr_min TEXT NOT NULL CHECK (target_cefr_min IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                target_cefr_max TEXT NOT NULL CHECK (target_cefr_max IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                difficulty TEXT NOT NULL CHECK (difficulty IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                anchor_used INTEGER NOT NULL CHECK (anchor_used IN (0, 1)),
                follow_ups_used INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed'))
            );
            CREATE INDEX IF NOT EXISTS idx_assessment_task_run_assessment ON assessment_task_run(assessment_id);

            CREATE TABLE IF NOT EXISTS assessment_turn (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_run_id INTEGER NOT NULL REFERENCES assessment_task_run(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('prompt', 'answer')),
                text TEXT NOT NULL,
                follow_up_intent TEXT,
                timestamp INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_assessment_turn_task_run ON assessment_turn(task_run_id, timestamp);

            CREATE TABLE IF NOT EXISTS assessment_evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_run_id INTEGER NOT NULL REFERENCES assessment_task_run(id) ON DELETE CASCADE,
                turn_id INTEGER NOT NULL REFERENCES assessment_turn(id) ON DELETE CASCADE,
                competency TEXT NOT NULL CHECK (competency IN (
                    'fluency', 'grammaticalRange', 'grammaticalAccuracy', 'lexicalResource',
                    'discourseManagement', 'interactiveCommunication', 'pronunciation', 'listening'
                )),
                estimated_level TEXT CHECK (estimated_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                confidence REAL NOT NULL,
                evidence TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_assessment_evidence_task_run ON assessment_evidence(task_run_id);
            CREATE INDEX IF NOT EXISTS idx_assessment_evidence_competency ON assessment_evidence(competency);",
        )?;
    }

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

// ---------------------------------------------------------------------
// Assessment persistence
//
// A fully separate set of tables from session/turn/correction/expression
// above: an assessment's Q&A shape (task runs made of prompt/answer turns,
// each answer scored per competency) doesn't fit the tutor conversation
// shape, and keeping them apart means an assessment retake never touches
// (or risks corrupting) ordinary conversation history.
// ---------------------------------------------------------------------

fn parse_cefr_level(value: &str) -> Result<CefrLevel, std::io::Error> {
    match value {
        "A1" => Ok(CefrLevel::A1),
        "A2" => Ok(CefrLevel::A2),
        "B1" => Ok(CefrLevel::B1),
        "B2" => Ok(CefrLevel::B2),
        "C1" => Ok(CefrLevel::C1),
        "C2" => Ok(CefrLevel::C2),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown CEFR level: {other}"),
        )),
    }
}

fn parse_competency(value: &str) -> Result<AssessmentCompetency, std::io::Error> {
    match value {
        "fluency" => Ok(AssessmentCompetency::Fluency),
        "grammaticalRange" => Ok(AssessmentCompetency::GrammaticalRange),
        "grammaticalAccuracy" => Ok(AssessmentCompetency::GrammaticalAccuracy),
        "lexicalResource" => Ok(AssessmentCompetency::LexicalResource),
        "discourseManagement" => Ok(AssessmentCompetency::DiscourseManagement),
        "interactiveCommunication" => Ok(AssessmentCompetency::InteractiveCommunication),
        "pronunciation" => Ok(AssessmentCompetency::Pronunciation),
        "listening" => Ok(AssessmentCompetency::Listening),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown competency: {other}"),
        )),
    }
}

fn column_conversion_error(column: usize, error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, Box::new(error))
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentSummary {
    id: i64,
    started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_level: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence: Option<f64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentEvidenceDetail {
    competency: AssessmentCompetency,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_level: Option<CefrLevel>,
    confidence: f64,
    evidence: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTurnDetail {
    id: i64,
    role: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    follow_up_intent: Option<String>,
    timestamp: i64,
    evidence: Vec<AssessmentEvidenceDetail>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTaskRunDetail {
    id: i64,
    task_id: String,
    target_cefr_min: CefrLevel,
    target_cefr_max: CefrLevel,
    difficulty: CefrLevel,
    anchor_used: bool,
    follow_ups_used: i64,
    status: String,
    turns: Vec<AssessmentTurnDetail>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentDetail {
    id: i64,
    started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<i64>,
    blueprint_version: String,
    rubric_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_level: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence: Option<f64>,
    task_runs: Vec<AssessmentTaskRunDetail>,
}

fn create_assessment(
    conn: &Connection,
    blueprint_version: &str,
    rubric_version: &str,
    started_at_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO assessment (started_at, blueprint_version, rubric_version) VALUES (?1, ?2, ?3)",
        params![started_at_ms, blueprint_version, rubric_version],
    )?;
    Ok(conn.last_insert_rowid())
}

fn create_assessment_task_run(
    conn: &Connection,
    assessment_id: i64,
    task_id: &str,
    target_cefr_min: CefrLevel,
    target_cefr_max: CefrLevel,
    difficulty: CefrLevel,
    anchor_used: bool,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO assessment_task_run
            (assessment_id, task_id, target_cefr_min, target_cefr_max, difficulty, anchor_used, follow_ups_used, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'in_progress')",
        params![
            assessment_id,
            task_id,
            cefr_level_str(target_cefr_min),
            cefr_level_str(target_cefr_max),
            cefr_level_str(difficulty),
            anchor_used as i64,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(clippy::type_complexity)]
fn record_assessment_turn_cycle(
    conn: &mut Connection,
    task_run_id: i64,
    prompt_text: &str,
    answer_text: &str,
    follow_up_intent: Option<&str>,
    evidence: &[(AssessmentCompetency, Option<CefrLevel>, f64, Vec<String>)],
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO assessment_turn (task_run_id, role, text, follow_up_intent, timestamp) VALUES (?1, 'prompt', ?2, ?3, ?4)",
        params![task_run_id, prompt_text, follow_up_intent, now_ms],
    )?;
    tx.execute(
        "INSERT INTO assessment_turn (task_run_id, role, text, follow_up_intent, timestamp) VALUES (?1, 'answer', ?2, ?3, ?4)",
        params![task_run_id, answer_text, follow_up_intent, now_ms],
    )?;
    let answer_turn_id = tx.last_insert_rowid();

    for (competency, level, confidence, quotes) in evidence {
        let evidence_json = serde_json::to_string(quotes).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT INTO assessment_evidence (task_run_id, turn_id, competency, estimated_level, confidence, evidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                task_run_id,
                answer_turn_id,
                competency_label(*competency),
                level.map(cefr_level_str),
                confidence,
                evidence_json,
            ],
        )?;
    }

    tx.commit()?;
    Ok(answer_turn_id)
}

fn finish_assessment_task_run(
    conn: &Connection,
    task_run_id: i64,
    follow_ups_used: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assessment_task_run SET follow_ups_used = ?1, status = 'completed' WHERE id = ?2",
        params![follow_ups_used, task_run_id],
    )?;
    Ok(())
}

fn finish_assessment(
    conn: &Connection,
    assessment_id: i64,
    estimated_level: Option<CefrLevel>,
    confidence: Option<f64>,
    completed_at_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assessment SET completed_at = ?1, estimated_level = ?2, confidence = ?3 WHERE id = ?4",
        params![
            completed_at_ms,
            estimated_level.map(cefr_level_str),
            confidence,
            assessment_id,
        ],
    )?;
    Ok(())
}

fn assessment_summary_from_row(row: &rusqlite::Row) -> rusqlite::Result<AssessmentSummary> {
    let estimated_level: Option<String> = row.get(3)?;
    Ok(AssessmentSummary {
        id: row.get(0)?,
        started_at: row.get(1)?,
        completed_at: row.get(2)?,
        estimated_level: estimated_level
            .map(|value| parse_cefr_level(&value))
            .transpose()
            .map_err(|error| column_conversion_error(3, error))?,
        confidence: row.get(4)?,
    })
}

fn recent_assessments(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<AssessmentSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, started_at, completed_at, estimated_level, confidence
         FROM assessment ORDER BY started_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], assessment_summary_from_row)?;
    rows.collect()
}

fn latest_assessment_row(conn: &Connection) -> rusqlite::Result<Option<AssessmentSummary>> {
    conn.query_row(
        "SELECT id, started_at, completed_at, estimated_level, confidence
         FROM assessment WHERE completed_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
        [],
        assessment_summary_from_row,
    )
    .optional()
}

fn task_runs_for_assessment(
    conn: &Connection,
    assessment_id: i64,
) -> rusqlite::Result<Vec<AssessmentTaskRunDetail>> {
    let mut statement = conn.prepare(
        "SELECT id, task_id, target_cefr_min, target_cefr_max, difficulty, anchor_used, follow_ups_used, status
         FROM assessment_task_run WHERE assessment_id = ?1 ORDER BY id ASC",
    )?;
    let rows = statement.query_map(params![assessment_id], |row| {
        let target_cefr_min: String = row.get(2)?;
        let target_cefr_max: String = row.get(3)?;
        let difficulty: String = row.get(4)?;
        let anchor_used: i64 = row.get(5)?;
        Ok(AssessmentTaskRunDetail {
            id: row.get(0)?,
            task_id: row.get(1)?,
            target_cefr_min: parse_cefr_level(&target_cefr_min)
                .map_err(|error| column_conversion_error(2, error))?,
            target_cefr_max: parse_cefr_level(&target_cefr_max)
                .map_err(|error| column_conversion_error(3, error))?,
            difficulty: parse_cefr_level(&difficulty)
                .map_err(|error| column_conversion_error(4, error))?,
            anchor_used: anchor_used != 0,
            follow_ups_used: row.get(6)?,
            status: row.get(7)?,
            turns: Vec::new(),
        })
    })?;
    rows.collect()
}

#[allow(clippy::type_complexity)]
fn assessment_detail(
    conn: &Connection,
    assessment_id: i64,
) -> rusqlite::Result<Option<AssessmentDetail>> {
    let assessment_row: Option<(i64, i64, Option<i64>, String, String, Option<String>, Option<f64>)> = conn
        .query_row(
            "SELECT id, started_at, completed_at, blueprint_version, rubric_version, estimated_level, confidence
             FROM assessment WHERE id = ?1",
            params![assessment_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()?;

    let Some((
        id,
        started_at,
        completed_at,
        blueprint_version,
        rubric_version,
        estimated_level_str,
        confidence,
    )) = assessment_row
    else {
        return Ok(None);
    };
    let estimated_level = estimated_level_str
        .map(|value| parse_cefr_level(&value))
        .transpose()
        .map_err(|error| column_conversion_error(5, error))?;

    let mut task_runs = task_runs_for_assessment(conn, id)?;

    let mut turns_statement = conn.prepare(
        "SELECT id, task_run_id, role, text, follow_up_intent, timestamp
         FROM assessment_turn WHERE task_run_id IN (
            SELECT id FROM assessment_task_run WHERE assessment_id = ?1
         ) ORDER BY timestamp ASC",
    )?;
    let turn_rows = turns_statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut evidence_statement = conn.prepare(
        "SELECT turn_id, competency, estimated_level, confidence, evidence
         FROM assessment_evidence WHERE task_run_id IN (
            SELECT id FROM assessment_task_run WHERE assessment_id = ?1
         )",
    )?;
    let evidence_rows = evidence_statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut evidence_by_turn: std::collections::HashMap<i64, Vec<AssessmentEvidenceDetail>> =
        std::collections::HashMap::new();
    for (turn_id, competency_str, level_str, confidence, evidence_json) in evidence_rows {
        let competency =
            parse_competency(&competency_str).map_err(|error| column_conversion_error(1, error))?;
        let estimated_level = level_str
            .map(|value| parse_cefr_level(&value))
            .transpose()
            .map_err(|error| column_conversion_error(2, error))?;
        let evidence: Vec<String> = serde_json::from_str(&evidence_json).unwrap_or_default();
        evidence_by_turn
            .entry(turn_id)
            .or_default()
            .push(AssessmentEvidenceDetail {
                competency,
                estimated_level,
                confidence,
                evidence,
            });
    }

    let mut turns_by_task_run: std::collections::HashMap<i64, Vec<AssessmentTurnDetail>> =
        std::collections::HashMap::new();
    for (turn_id, task_run_id, role, text, follow_up_intent, timestamp) in turn_rows {
        let evidence = evidence_by_turn.remove(&turn_id).unwrap_or_default();
        turns_by_task_run
            .entry(task_run_id)
            .or_default()
            .push(AssessmentTurnDetail {
                id: turn_id,
                role,
                text,
                follow_up_intent,
                timestamp,
                evidence,
            });
    }

    for task_run in &mut task_runs {
        task_run.turns = turns_by_task_run.remove(&task_run.id).unwrap_or_default();
    }

    Ok(Some(AssessmentDetail {
        id,
        started_at,
        completed_at,
        blueprint_version,
        rubric_version,
        estimated_level,
        confidence,
        task_runs,
    }))
}

pub(crate) async fn start_assessment(
    app_handle: &AppHandle,
    blueprint_version: String,
    rubric_version: String,
) -> Result<i64, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(create_assessment(
            &conn,
            &blueprint_version,
            &rubric_version,
            now_ms(),
        )?)
    })
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn start_assessment_task_run(
    app_handle: &AppHandle,
    assessment_id: i64,
    task_id: String,
    target_cefr_min: CefrLevel,
    target_cefr_max: CefrLevel,
    difficulty: CefrLevel,
    anchor_used: bool,
) -> Result<i64, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(create_assessment_task_run(
            &conn,
            assessment_id,
            &task_id,
            target_cefr_min,
            target_cefr_max,
            difficulty,
            anchor_used,
        )?)
    })
    .await
}

pub(crate) async fn persist_assessment_turn_cycle(
    app_handle: &AppHandle,
    task_run_id: i64,
    prompt_text: String,
    answer_text: String,
    follow_up_intent: Option<String>,
    evidence: Vec<(AssessmentCompetency, Option<CefrLevel>, f64, Vec<String>)>,
) -> Result<i64, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let mut conn = open_connection(&path)?;
        Ok(record_assessment_turn_cycle(
            &mut conn,
            task_run_id,
            &prompt_text,
            &answer_text,
            follow_up_intent.as_deref(),
            &evidence,
            now_ms(),
        )?)
    })
    .await
}

pub(crate) async fn complete_assessment_task_run(
    app_handle: &AppHandle,
    task_run_id: i64,
    follow_ups_used: i64,
) -> Result<(), HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(finish_assessment_task_run(
            &conn,
            task_run_id,
            follow_ups_used,
        )?)
    })
    .await
}

pub(crate) async fn complete_assessment(
    app_handle: &AppHandle,
    assessment_id: i64,
    estimated_level: Option<CefrLevel>,
    confidence: Option<f64>,
) -> Result<(), HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(finish_assessment(
            &conn,
            assessment_id,
            estimated_level,
            confidence,
            now_ms(),
        )?)
    })
    .await
}

pub(crate) async fn list_assessment_results(
    app_handle: &AppHandle,
    limit: Option<u32>,
) -> Result<Vec<AssessmentSummary>, HistoryCommandError> {
    let path = db_path(app_handle)?;
    let limit = clamp_limit(limit);
    run_blocking(move || Ok(recent_assessments(&open_connection(&path)?, limit)?)).await
}

pub(crate) async fn latest_assessment_result(
    app_handle: &AppHandle,
) -> Result<Option<AssessmentSummary>, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || Ok(latest_assessment_row(&open_connection(&path)?)?)).await
}

pub(crate) async fn assessment_detail_by_id(
    app_handle: &AppHandle,
    assessment_id: i64,
) -> Result<Option<AssessmentDetail>, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || Ok(assessment_detail(&open_connection(&path)?, assessment_id)?)).await
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
            &[correction(
                CorrectionCategory::Grammar,
                CorrectionSeverity::Important,
            )],
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
            &[correction(
                CorrectionCategory::Grammar,
                CorrectionSeverity::Important,
            )],
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

    #[test]
    fn migration_from_version_1_adds_assessment_tables_without_touching_existing_data() {
        let (_directory, path) = scratch_db();

        // Simulate a database that was already at schema version 1, before
        // the assessment tables existed.
        {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE session (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER NOT NULL,
                    mode TEXT,
                    topic TEXT
                );
                INSERT INTO session (started_at, ended_at) VALUES (1000, 2000);",
            )
            .expect("v1 schema must create");
            conn.pragma_update(None, "user_version", 1)
                .expect("version must set");
        }

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session", [], |row| row.get(0))
            .expect("session table must survive migration");
        assert_eq!(session_count, 1);

        let assessment_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'assessment'",
                [],
                |row| row.get(0),
            )
            .expect("sqlite_master must query");
        assert_eq!(assessment_table_exists, 1);
    }

    fn seed_completed_assessment(conn: &mut Connection, started_at_ms: i64) -> i64 {
        let assessment_id =
            create_assessment(conn, "blueprint-2026.1", "rubric-2026.1", started_at_ms)
                .expect("assessment must create");
        let task_run_id = create_assessment_task_run(
            conn,
            assessment_id,
            "extended_production.technical_decision.v1",
            CefrLevel::B2,
            CefrLevel::C1,
            CefrLevel::B2,
            true,
        )
        .expect("task run must create");
        record_assessment_turn_cycle(
            conn,
            task_run_id,
            "Tell me about a technical decision you made recently.",
            "We migrated the application because maintaining the old stack was becoming difficult.",
            None,
            &[
                (
                    AssessmentCompetency::Fluency,
                    Some(CefrLevel::B2),
                    0.84,
                    vec!["Maintained an extended response with limited hesitation.".into()],
                ),
                (AssessmentCompetency::Listening, None, 0.0, vec![]),
            ],
            started_at_ms + 1_000,
        )
        .expect("turn cycle must record");
        finish_assessment_task_run(conn, task_run_id, 0).expect("task run must complete");
        finish_assessment(
            conn,
            assessment_id,
            Some(CefrLevel::B2),
            Some(0.75),
            started_at_ms + 2_000,
        )
        .expect("assessment must complete");
        assessment_id
    }

    #[test]
    fn insert_and_read_latest_assessment_result_round_trips_payload() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let assessment_id = seed_completed_assessment(&mut conn, 1_000);

        let latest = latest_assessment_row(&conn)
            .expect("latest must query")
            .expect("an assessment must exist");
        assert_eq!(latest.id, assessment_id);
        assert_eq!(latest.estimated_level, Some(CefrLevel::B2));
        assert_eq!(latest.confidence, Some(0.75));

        let detail = assessment_detail(&conn, assessment_id)
            .expect("detail must query")
            .expect("detail must exist");
        assert_eq!(detail.blueprint_version, "blueprint-2026.1");
        assert_eq!(detail.rubric_version, "rubric-2026.1");
        assert_eq!(detail.task_runs.len(), 1);
        let task_run = &detail.task_runs[0];
        assert_eq!(task_run.status, "completed");
        assert_eq!(task_run.turns.len(), 2);

        let answer_turn = task_run
            .turns
            .iter()
            .find(|turn| turn.role == "answer")
            .expect("answer turn must exist");
        assert_eq!(answer_turn.evidence.len(), 2);
        let fluency = answer_turn
            .evidence
            .iter()
            .find(|entry| entry.competency == AssessmentCompetency::Fluency)
            .expect("fluency evidence must exist");
        assert_eq!(fluency.estimated_level, Some(CefrLevel::B2));
        assert_eq!(
            fluency.evidence,
            vec!["Maintained an extended response with limited hesitation.".to_string()]
        );
        let listening = answer_turn
            .evidence
            .iter()
            .find(|entry| entry.competency == AssessmentCompetency::Listening)
            .expect("listening evidence must exist");
        assert_eq!(listening.estimated_level, None);

        let prompt_turn = task_run
            .turns
            .iter()
            .find(|turn| turn.role == "prompt")
            .expect("prompt turn must exist");
        assert!(prompt_turn.evidence.is_empty());
    }

    #[test]
    fn recent_assessments_orders_newest_first_and_respects_limit() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        seed_completed_assessment(&mut conn, 1_000);
        seed_completed_assessment(&mut conn, 2_000);
        seed_completed_assessment(&mut conn, 3_000);

        let results = recent_assessments(&conn, 2).expect("results must query");
        assert_eq!(results.len(), 2);
        assert!(results[0].started_at > results[1].started_at);
        assert_eq!(results[0].started_at, 3_000);
    }

    #[test]
    fn latest_assessment_result_is_none_when_no_assessment_completed() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");

        assert_eq!(
            latest_assessment_row(&conn).expect("query must succeed"),
            None
        );

        let assessment_id = create_assessment(&conn, "blueprint-2026.1", "rubric-2026.1", 1_000)
            .expect("assessment must create");
        let _ = assessment_id;

        // Started but never completed: still must not appear as "latest".
        assert_eq!(
            latest_assessment_row(&conn).expect("query must succeed"),
            None
        );

        seed_completed_assessment(&mut conn, 2_000);
        assert!(latest_assessment_row(&conn)
            .expect("query must succeed")
            .is_some());
    }

    #[test]
    fn rerunning_assessment_does_not_delete_prior_results() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");

        let first_id = seed_completed_assessment(&mut conn, 1_000);
        let second_id = seed_completed_assessment(&mut conn, 2_000);

        assert_ne!(first_id, second_id);

        let all_results = recent_assessments(&conn, 100).expect("results must query");
        assert_eq!(all_results.len(), 2);

        let first_detail = assessment_detail(&conn, first_id)
            .expect("detail must query")
            .expect("first assessment must still exist");
        assert_eq!(first_detail.id, first_id);
        assert!(!first_detail.task_runs.is_empty());

        let latest = latest_assessment_row(&conn)
            .expect("latest must query")
            .expect("latest must exist");
        assert_eq!(latest.id, second_id);
    }
}
