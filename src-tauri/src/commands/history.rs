use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::assessment::{cefr_level_str, competency_label, AssessmentCompetency, CefrLevel};
use super::listening::ListeningCheckType;
use super::pronunciation::{self, PronunciationProblemCategory, PronunciationTargetSource};
use super::repair::{RepairIntensity, RepairMode, RepairOutcome, RepairPriority};
use super::review::{self, ReviewItemType, ReviewOutcome, ReviewSource};
use super::tutor::{
    BetterExpression, CorrectionCategory, CorrectionSeverity, TutorCorrection, TutorMessage,
    TutorMessageRole,
};

const DB_FILE_NAME: &str = "history.sqlite3";
const SCHEMA_VERSION: i32 = 8;
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
    pub(crate) fn new(
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionRunStatus {
    Active,
    Completed,
    Abandoned,
}

pub(crate) fn session_run_status_str(status: SessionRunStatus) -> &'static str {
    match status {
        SessionRunStatus::Active => "active",
        SessionRunStatus::Completed => "completed",
        SessionRunStatus::Abandoned => "abandoned",
    }
}

fn parse_session_run_status(value: &str) -> Result<SessionRunStatus, std::io::Error> {
    match value {
        "active" => Ok(SessionRunStatus::Active),
        "completed" => Ok(SessionRunStatus::Completed),
        "abandoned" => Ok(SessionRunStatus::Abandoned),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown session status: {other}"),
        )),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSessionRequest {
    #[serde(default)]
    scenario_id: Option<String>,
    #[serde(default)]
    difficulty: Option<CefrLevel>,
    #[serde(default)]
    focus: Option<String>,
    #[serde(default)]
    target_turns: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteSessionRequest {
    session_id: i64,
    status: SessionRunStatus,
    #[serde(default)]
    summary: Option<super::session::SessionSummaryPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinueSessionRequest {
    session_id: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResumeContext {
    source_session_id: i64,
    continuation_session_id: i64,
    recent_messages: Vec<TutorMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prior_summary: Option<super::session::SessionSummaryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    learner_context: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    due_review_items: Vec<review::ReviewItem>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionStart {
    session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    learner_context: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    due_review_items: Vec<review::ReviewItem>,
    listening_profile: super::learner_profile::ListeningProfile,
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
    status: SessionRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    difficulty: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<super::session::SessionSummaryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_user_turn: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    pub(crate) category: String,
    pub(crate) count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpressionSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) original: Option<String>,
    pub(crate) suggestion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) explanation: Option<String>,
    pub(crate) timestamp: i64,
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

fn parse_correction_category(value: &str) -> Result<CorrectionCategory, std::io::Error> {
    match value {
        "grammar" => Ok(CorrectionCategory::Grammar),
        "vocabulary" => Ok(CorrectionCategory::Vocabulary),
        "naturalness" => Ok(CorrectionCategory::Naturalness),
        "clarity" => Ok(CorrectionCategory::Clarity),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown correction category: {other}"),
        )),
    }
}

fn parse_correction_severity(value: &str) -> Result<CorrectionSeverity, std::io::Error> {
    match value {
        "minor" => Ok(CorrectionSeverity::Minor),
        "important" => Ok(CorrectionSeverity::Important),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown correction severity: {other}"),
        )),
    }
}

fn repair_priority_str(priority: RepairPriority) -> &'static str {
    match priority {
        RepairPriority::Grammar => "grammar",
        RepairPriority::Vocabulary => "vocabulary",
        RepairPriority::Pronunciation => "pronunciation",
        RepairPriority::Fluency => "fluency",
        RepairPriority::Coherence => "coherence",
        RepairPriority::Pragmatics => "pragmatics",
    }
}

fn repair_mode_str(mode: RepairMode) -> &'static str {
    match mode {
        RepairMode::Implicit => "implicit",
        RepairMode::Quick => "quick",
        RepairMode::Repair => "repair",
    }
}

fn repair_outcome_str(outcome: RepairOutcome) -> &'static str {
    match outcome {
        RepairOutcome::Improved => "improved",
        RepairOutcome::Failed => "failed",
        RepairOutcome::Skipped => "skipped",
    }
}

fn repair_intensity_str(intensity: RepairIntensity) -> &'static str {
    match intensity {
        RepairIntensity::Light => "light",
        RepairIntensity::Balanced => "balanced",
        RepairIntensity::Strict => "strict",
    }
}

fn parse_repair_priority(value: &str) -> Result<RepairPriority, std::io::Error> {
    match value {
        "grammar" => Ok(RepairPriority::Grammar),
        "vocabulary" => Ok(RepairPriority::Vocabulary),
        "pronunciation" => Ok(RepairPriority::Pronunciation),
        "fluency" => Ok(RepairPriority::Fluency),
        "coherence" => Ok(RepairPriority::Coherence),
        "pragmatics" => Ok(RepairPriority::Pragmatics),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown repair priority: {other}"),
        )),
    }
}

fn parse_repair_mode(value: &str) -> Result<RepairMode, std::io::Error> {
    match value {
        "implicit" => Ok(RepairMode::Implicit),
        "quick" => Ok(RepairMode::Quick),
        "repair" => Ok(RepairMode::Repair),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown repair mode: {other}"),
        )),
    }
}

fn parse_repair_outcome(value: &str) -> Result<RepairOutcome, std::io::Error> {
    match value {
        "improved" => Ok(RepairOutcome::Improved),
        "failed" => Ok(RepairOutcome::Failed),
        "skipped" => Ok(RepairOutcome::Skipped),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown repair outcome: {other}"),
        )),
    }
}

fn parse_repair_intensity(value: &str) -> Result<RepairIntensity, std::io::Error> {
    match value {
        "light" => Ok(RepairIntensity::Light),
        "balanced" => Ok(RepairIntensity::Balanced),
        "strict" => Ok(RepairIntensity::Strict),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown repair intensity: {other}"),
        )),
    }
}

fn review_item_type_str(item_type: ReviewItemType) -> &'static str {
    match item_type {
        ReviewItemType::GrammarPattern => "grammar_pattern",
        ReviewItemType::Vocabulary => "vocabulary",
        ReviewItemType::Phrase => "phrase",
        ReviewItemType::PronunciationTarget => "pronunciation_target",
        ReviewItemType::ConversationStrategy => "conversation_strategy",
    }
}

pub(crate) fn parse_review_item_type(value: &str) -> Result<ReviewItemType, std::io::Error> {
    match value {
        "grammar_pattern" => Ok(ReviewItemType::GrammarPattern),
        "vocabulary" => Ok(ReviewItemType::Vocabulary),
        "phrase" => Ok(ReviewItemType::Phrase),
        "pronunciation_target" => Ok(ReviewItemType::PronunciationTarget),
        "conversation_strategy" => Ok(ReviewItemType::ConversationStrategy),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown review item type: {other}"),
        )),
    }
}

fn review_source_str(source: ReviewSource) -> &'static str {
    match source {
        ReviewSource::RepairEvent => "repair_event",
        ReviewSource::SessionSummary => "session_summary",
        ReviewSource::AssessmentPriority => "assessment_priority",
    }
}

fn parse_review_source(value: &str) -> Result<ReviewSource, std::io::Error> {
    match value {
        "repair_event" => Ok(ReviewSource::RepairEvent),
        "session_summary" => Ok(ReviewSource::SessionSummary),
        "assessment_priority" => Ok(ReviewSource::AssessmentPriority),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown review source: {other}"),
        )),
    }
}

fn review_outcome_str(outcome: ReviewOutcome) -> &'static str {
    match outcome {
        ReviewOutcome::Remembered => "remembered",
        ReviewOutcome::PartiallyRemembered => "partially_remembered",
        ReviewOutcome::Missed => "missed",
        ReviewOutcome::Skipped => "skipped",
    }
}

fn parse_review_outcome(value: &str) -> Result<ReviewOutcome, std::io::Error> {
    match value {
        "remembered" => Ok(ReviewOutcome::Remembered),
        "partially_remembered" => Ok(ReviewOutcome::PartiallyRemembered),
        "missed" => Ok(ReviewOutcome::Missed),
        "skipped" => Ok(ReviewOutcome::Skipped),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown review outcome: {other}"),
        )),
    }
}

pub(crate) fn db_path(app_handle: &AppHandle) -> Result<PathBuf, HistoryCommandError> {
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

    if current_version < 3 {
        conn.execute_batch(
            "ALTER TABLE session ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'completed', 'abandoned'));
            ALTER TABLE session ADD COLUMN difficulty TEXT
                CHECK (difficulty IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
            ALTER TABLE session ADD COLUMN target_turns INTEGER;
            ALTER TABLE session ADD COLUMN summary_json TEXT;",
        )?;
    }

    if current_version < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS repair_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                priority TEXT NOT NULL CHECK (priority IN (
                    'grammar', 'vocabulary', 'pronunciation', 'fluency', 'coherence', 'pragmatics'
                )),
                issue TEXT NOT NULL,
                original TEXT NOT NULL,
                suggested TEXT NOT NULL,
                micro_explanation TEXT NOT NULL,
                repair_prompt TEXT,
                mode TEXT NOT NULL CHECK (mode IN ('implicit', 'quick', 'repair')),
                outcome TEXT CHECK (outcome IN ('improved', 'failed', 'skipped')),
                intensity TEXT NOT NULL CHECK (intensity IN ('light', 'balanced', 'strict')),
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_repair_event_turn ON repair_event(turn_id);
            CREATE INDEX IF NOT EXISTS idx_repair_event_priority ON repair_event(priority);",
        )?;
    }

    if current_version < 5 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS review_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK (type IN (
                    'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                )),
                content TEXT NOT NULL,
                source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary', 'assessment_priority')),
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                source_assessment_id INTEGER REFERENCES assessment(id) ON DELETE SET NULL,
                stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                next_review_at INTEGER NOT NULL,
                last_reviewed_at INTEGER,
                review_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_review_item_next_review_at ON review_item(next_review_at);
            CREATE INDEX IF NOT EXISTS idx_review_item_type ON review_item(type);

            CREATE TABLE IF NOT EXISTS review_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_item_id INTEGER NOT NULL REFERENCES review_item(id) ON DELETE CASCADE,
                session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                outcome TEXT NOT NULL CHECK (outcome IN ('remembered', 'partially_remembered', 'missed', 'skipped')),
                previous_stage INTEGER NOT NULL,
                new_stage INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_review_event_review_item ON review_event(review_item_id);
            CREATE INDEX IF NOT EXISTS idx_review_event_session ON review_event(session_id);",
        )?;
    }

    if current_version < 6 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pronunciation_target (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL,
                source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary')),
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pronunciation_target_created_at ON pronunciation_target(created_at);

            CREATE TABLE IF NOT EXISTS pronunciation_attempt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pronunciation_target_id INTEGER NOT NULL REFERENCES pronunciation_target(id) ON DELETE CASCADE,
                session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                transcript TEXT NOT NULL,
                is_match INTEGER NOT NULL CHECK (is_match IN (0, 1)),
                problem_category TEXT CHECK (problem_category IN (
                    'word_stress', 'final_consonants', 'vowel_contrast', 'connected_speech', 'rhythm', 'specific_word'
                )),
                diff_json TEXT NOT NULL,
                hint TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pronunciation_attempt_target ON pronunciation_attempt(pronunciation_target_id, created_at);

            ALTER TABLE review_item ADD COLUMN source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL;",
        )?;
    }

    if current_version < 7 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS listening_check (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                tutor_reply TEXT NOT NULL,
                check_type TEXT NOT NULL CHECK (check_type IN (
                    'detail_question', 'summary_choice', 'repeat_own_words', 'detail_followup'
                )),
                question TEXT NOT NULL,
                options_json TEXT,
                correct_option_index INTEGER,
                expected_criteria TEXT,
                stage INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_listening_check_session ON listening_check(session_id, created_at);

            CREATE TABLE IF NOT EXISTS listening_check_attempt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                listening_check_id INTEGER NOT NULL REFERENCES listening_check(id) ON DELETE CASCADE,
                answer TEXT NOT NULL,
                is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
                feedback TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_listening_check_attempt_check ON listening_check_attempt(listening_check_id);",
        )?;
    }

    if current_version < 8 {
        conn.execute_batch(
            "ALTER TABLE session ADD COLUMN continued_from_session_id INTEGER
                REFERENCES session(id) ON DELETE SET NULL;",
        )?;
    }

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

pub(crate) fn open_connection(path: &Path) -> Result<Connection, HistoryCommandError> {
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

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_session(
    conn: &Connection,
    started_at_ms: i64,
    scenario_id: Option<&str>,
    focus: Option<&str>,
    difficulty: Option<CefrLevel>,
    target_turns: Option<i64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO session (started_at, ended_at, mode, topic, difficulty, target_turns, status)
         VALUES (?1, ?1, ?2, ?3, ?4, ?5, 'active')",
        params![
            started_at_ms,
            scenario_id,
            focus,
            difficulty.map(cefr_level_str),
            target_turns,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn complete_session_run(
    conn: &Connection,
    session_id: i64,
    status: SessionRunStatus,
    summary_json: Option<&str>,
    ended_at_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE session SET ended_at = ?1, status = ?2, summary_json = ?3 WHERE id = ?4",
        params![
            ended_at_ms,
            session_run_status_str(status),
            summary_json,
            session_id
        ],
    )?;
    Ok(())
}

/// One-sentence nudge folded into `learnerContext` only when resuming a
/// `completed` conversation's linked continuation. Pure and testable like
/// `compose_tutor_summary` / `compose_review_context`.
fn compose_resume_priority_issues(
    prior_summary: Option<&super::session::SessionSummaryPayload>,
) -> Option<String> {
    let issues = prior_summary.map(|summary| summary.priority_issues.as_slice())?;
    if issues.is_empty() {
        return None;
    }
    let joined = issues
        .iter()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join(" and ");
    Some(format!(
        "The learner is continuing a previous conversation where {joined} came up. \
         Don't drill these explicitly. When natural, create conversation opportunities \
         where these may come up again."
    ))
}

pub(crate) struct SessionContinuation {
    pub(crate) continuation_session_id: i64,
    pub(crate) prior_summary: Option<super::session::SessionSummaryPayload>,
    pub(crate) recent_messages: Vec<TutorMessage>,
}

/// Implements the active/abandoned/completed resume policy: active and
/// abandoned sessions are continued in place (abandoned flips back to
/// active); completed sessions are never reopened or mutated — a new linked
/// session is created instead, so a finished session's summary/status/
/// metrics stay intact.
#[allow(clippy::type_complexity)]
pub(crate) fn continue_session_run(
    conn: &Connection,
    source_session_id: i64,
    now_ms: i64,
) -> rusqlite::Result<Option<SessionContinuation>> {
    let row: Option<(String, Option<String>, Option<String>, Option<String>, Option<i64>, Option<String>)> =
        conn.query_row(
            "SELECT status, mode, topic, difficulty, target_turns, summary_json FROM session WHERE id = ?1",
            params![source_session_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;

    let Some((status_str, mode, topic, difficulty, target_turns, summary_json)) = row else {
        return Ok(None);
    };
    let status = parse_session_run_status(&status_str).map_err(|error| column_conversion_error(0, error))?;

    let turn_rows = turns_for_session(conn, source_session_id)?;
    let recent_messages = recent_tutor_messages(&turn_rows, RESUME_RECENT_MESSAGE_LIMIT);

    match status {
        SessionRunStatus::Active | SessionRunStatus::Abandoned => {
            if status == SessionRunStatus::Abandoned {
                conn.execute(
                    "UPDATE session SET status = 'active' WHERE id = ?1",
                    params![source_session_id],
                )?;
            }
            Ok(Some(SessionContinuation {
                continuation_session_id: source_session_id,
                prior_summary: None,
                recent_messages,
            }))
        }
        SessionRunStatus::Completed => {
            let prior_summary = summary_json
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|error| {
                    column_conversion_error(5, std::io::Error::new(std::io::ErrorKind::InvalidData, error))
                })?;

            conn.execute(
                "INSERT INTO session (started_at, ended_at, mode, topic, difficulty, target_turns, status, continued_from_session_id)
                 VALUES (?1, ?1, ?2, ?3, ?4, ?5, 'active', ?6)",
                params![now_ms, mode, topic, difficulty, target_turns, source_session_id],
            )?;

            Ok(Some(SessionContinuation {
                continuation_session_id: conn.last_insert_rowid(),
                prior_summary,
                recent_messages,
            }))
        }
    }
}

pub(crate) fn record_turn_pair(
    conn: &mut Connection,
    session_id: i64,
    transcript: &str,
    reply: &str,
    corrections: &[TutorCorrection],
    expressions: &[BetterExpression],
    now_ms: i64,
) -> rusqlite::Result<i64> {
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

    tx.commit()?;
    Ok(user_turn_id)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_repair_event(
    conn: &Connection,
    turn_id: i64,
    priority: RepairPriority,
    issue: &str,
    original: &str,
    suggested: &str,
    micro_explanation: &str,
    repair_prompt: Option<&str>,
    mode: RepairMode,
    intensity: RepairIntensity,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO repair_event
            (turn_id, priority, issue, original, suggested, micro_explanation, repair_prompt, mode, outcome, intensity, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
        params![
            turn_id,
            repair_priority_str(priority),
            issue,
            original,
            suggested,
            micro_explanation,
            repair_prompt,
            repair_mode_str(mode),
            repair_intensity_str(intensity),
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn update_repair_event_outcome(
    conn: &Connection,
    event_id: i64,
    outcome: RepairOutcome,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE repair_event SET outcome = ?1 WHERE id = ?2",
        params![repair_outcome_str(outcome), event_id],
    )?;
    Ok(())
}

pub(crate) fn repair_priority_counts(
    conn: &Connection,
    recent_limit: i64,
) -> rusqlite::Result<Vec<CategoryCount>> {
    let mut statement = conn.prepare(
        "SELECT priority, COUNT(*) as count FROM (
            SELECT r.priority FROM repair_event r
            JOIN turn t ON t.id = r.turn_id
            ORDER BY t.timestamp DESC
            LIMIT ?1
         )
         GROUP BY priority
         ORDER BY count DESC, priority ASC",
    )?;
    let rows = statement.query_map(params![recent_limit], |row| {
        Ok(CategoryCount {
            category: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn get_repair_event_core(
    conn: &Connection,
    event_id: i64,
) -> rusqlite::Result<Option<(RepairPriority, String, String, String)>> {
    conn.query_row(
        "SELECT priority, issue, original, suggested FROM repair_event WHERE id = ?1",
        params![event_id],
        |row| {
            let priority: String = row.get(0)?;
            let issue: String = row.get(1)?;
            let original: String = row.get(2)?;
            let suggested: String = row.get(3)?;
            Ok((priority, issue, original, suggested))
        },
    )
    .optional()?
    .map(|(priority, issue, original, suggested)| {
        parse_repair_priority(&priority)
            .map(|priority| (priority, issue, original, suggested))
            .map_err(|error| column_conversion_error(0, error))
    })
    .transpose()
}

// ---------------------------------------------------------------------
// Review item persistence (spaced retrieval)
// ---------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_review_item(
    conn: &Connection,
    item_type: ReviewItemType,
    content: &str,
    source: ReviewSource,
    source_repair_event_id: Option<i64>,
    source_session_id: Option<i64>,
    source_assessment_id: Option<i64>,
    source_pronunciation_target_id: Option<i64>,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO review_item
            (type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
             source_pronunciation_target_id, stage, next_review_at, last_reviewed_at, review_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, NULL, 0, ?8)",
        params![
            review_item_type_str(item_type),
            content,
            review_source_str(source),
            source_repair_event_id,
            source_session_id,
            source_assessment_id,
            source_pronunciation_target_id,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

// ---------------------------------------------------------------------
// Pronunciation target / attempt persistence
// ---------------------------------------------------------------------

fn pronunciation_target_source_str(source: PronunciationTargetSource) -> &'static str {
    match source {
        PronunciationTargetSource::RepairEvent => "repair_event",
        PronunciationTargetSource::SessionSummary => "session_summary",
    }
}

fn parse_pronunciation_target_source(
    value: &str,
) -> Result<PronunciationTargetSource, std::io::Error> {
    match value {
        "repair_event" => Ok(PronunciationTargetSource::RepairEvent),
        "session_summary" => Ok(PronunciationTargetSource::SessionSummary),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown pronunciation target source: {other}"),
        )),
    }
}

fn pronunciation_problem_category_str(category: PronunciationProblemCategory) -> &'static str {
    match category {
        PronunciationProblemCategory::WordStress => "word_stress",
        PronunciationProblemCategory::FinalConsonants => "final_consonants",
        PronunciationProblemCategory::VowelContrast => "vowel_contrast",
        PronunciationProblemCategory::ConnectedSpeech => "connected_speech",
        PronunciationProblemCategory::Rhythm => "rhythm",
        PronunciationProblemCategory::SpecificWord => "specific_word",
    }
}

pub(crate) fn insert_pronunciation_target(
    conn: &Connection,
    phrase: &str,
    source: PronunciationTargetSource,
    source_repair_event_id: Option<i64>,
    source_session_id: Option<i64>,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO pronunciation_target
            (phrase, source, source_repair_event_id, source_session_id, review_item_id, created_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
        params![
            phrase,
            pronunciation_target_source_str(source),
            source_repair_event_id,
            source_session_id,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) struct PronunciationTargetCore {
    pub(crate) phrase: String,
    pub(crate) source: PronunciationTargetSource,
    pub(crate) source_repair_event_id: Option<i64>,
    pub(crate) source_session_id: Option<i64>,
    pub(crate) review_item_id: Option<i64>,
}

pub(crate) fn pronunciation_target_core(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<Option<PronunciationTargetCore>> {
    conn.query_row(
        "SELECT phrase, source, source_repair_event_id, source_session_id, review_item_id
         FROM pronunciation_target WHERE id = ?1",
        params![id],
        |row| {
            let source: String = row.get(1)?;
            Ok(PronunciationTargetCore {
                phrase: row.get(0)?,
                source: parse_pronunciation_target_source(&source)
                    .map_err(|error| column_conversion_error(1, error))?,
                source_repair_event_id: row.get(2)?,
                source_session_id: row.get(3)?,
                review_item_id: row.get(4)?,
            })
        },
    )
    .optional()
}

pub(crate) fn set_pronunciation_target_review_item(
    conn: &Connection,
    target_id: i64,
    review_item_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pronunciation_target SET review_item_id = ?1 WHERE id = ?2",
        params![review_item_id, target_id],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_pronunciation_attempt(
    conn: &Connection,
    target_id: i64,
    session_id: Option<i64>,
    transcript: &str,
    is_match: bool,
    category: Option<PronunciationProblemCategory>,
    diff_json: &str,
    hint: &str,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO pronunciation_attempt
            (pronunciation_target_id, session_id, transcript, is_match, problem_category, diff_json, hint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            target_id,
            session_id,
            transcript,
            is_match as i64,
            category.map(pronunciation_problem_category_str),
            diff_json,
            hint,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn list_pronunciation_targets_with_stats(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<pronunciation::PronunciationTarget>> {
    let mut statement = conn.prepare(
        "SELECT pt.id, pt.phrase, pt.source, pt.created_at, pt.review_item_id,
                COUNT(pa.id) AS attempt_count, MAX(pa.created_at) AS last_attempt_at
         FROM pronunciation_target pt
         LEFT JOIN pronunciation_attempt pa ON pa.pronunciation_target_id = pt.id
         GROUP BY pt.id
         ORDER BY pt.created_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        let source: String = row.get(2)?;
        let review_item_id: Option<i64> = row.get(4)?;
        Ok(pronunciation::PronunciationTarget {
            id: row.get(0)?,
            phrase: row.get(1)?,
            source: parse_pronunciation_target_source(&source)
                .map_err(|error| column_conversion_error(2, error))?,
            created_at: row.get(3)?,
            attempt_count: row.get(5)?,
            last_attempt_at: row.get(6)?,
            is_promoted: review_item_id.is_some(),
        })
    })?;
    rows.collect()
}

/// "Active" pronunciation targets for the learner profile: ones that have
/// never yet been said correctly (no attempt with `is_match = 1`) — mirrors
/// how `active_vocabulary`/`active_grammar_targets` surface unresolved work.
pub(crate) fn recent_unresolved_pronunciation_targets(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT phrase FROM pronunciation_target pt
         WHERE NOT EXISTS (
             SELECT 1 FROM pronunciation_attempt pa
             WHERE pa.pronunciation_target_id = pt.id AND pa.is_match = 1
         )
         ORDER BY pt.created_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn listening_check_type_str(check_type: ListeningCheckType) -> &'static str {
    match check_type {
        ListeningCheckType::DetailQuestion => "detail_question",
        ListeningCheckType::SummaryChoice => "summary_choice",
        ListeningCheckType::RepeatOwnWords => "repeat_own_words",
        ListeningCheckType::DetailFollowup => "detail_followup",
    }
}

fn parse_listening_check_type(value: &str) -> Result<ListeningCheckType, std::io::Error> {
    match value {
        "detail_question" => Ok(ListeningCheckType::DetailQuestion),
        "summary_choice" => Ok(ListeningCheckType::SummaryChoice),
        "repeat_own_words" => Ok(ListeningCheckType::RepeatOwnWords),
        "detail_followup" => Ok(ListeningCheckType::DetailFollowup),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown listening check type: {other}"),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_listening_check(
    conn: &Connection,
    session_id: Option<i64>,
    tutor_reply: &str,
    check_type: ListeningCheckType,
    question: &str,
    options_json: Option<&str>,
    correct_option_index: Option<i64>,
    expected_criteria: Option<&str>,
    stage: i32,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO listening_check
            (session_id, tutor_reply, check_type, question, options_json, correct_option_index, expected_criteria, stage, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            session_id,
            tutor_reply,
            listening_check_type_str(check_type),
            question,
            options_json,
            correct_option_index,
            expected_criteria,
            stage,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) struct ListeningCheckCore {
    pub(crate) tutor_reply: String,
    pub(crate) check_type: ListeningCheckType,
    pub(crate) question: String,
    pub(crate) options: Vec<String>,
    pub(crate) correct_option_index: Option<i64>,
    pub(crate) expected_criteria: Option<String>,
}

pub(crate) fn listening_check_core(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<Option<ListeningCheckCore>> {
    conn.query_row(
        "SELECT tutor_reply, check_type, question, options_json, correct_option_index, expected_criteria
         FROM listening_check WHERE id = ?1",
        params![id],
        |row| {
            let check_type: String = row.get(1)?;
            let options_json: Option<String> = row.get(3)?;
            let options = options_json
                .as_deref()
                .map(serde_json::from_str::<Vec<String>>)
                .transpose()
                .map_err(|error| {
                    column_conversion_error(3, std::io::Error::new(std::io::ErrorKind::InvalidData, error))
                })?
                .unwrap_or_default();
            Ok(ListeningCheckCore {
                tutor_reply: row.get(0)?,
                check_type: parse_listening_check_type(&check_type)
                    .map_err(|error| column_conversion_error(1, error))?,
                question: row.get(2)?,
                options,
                correct_option_index: row.get(4)?,
                expected_criteria: row.get(5)?,
            })
        },
    )
    .optional()
}

pub(crate) fn insert_listening_check_attempt(
    conn: &Connection,
    listening_check_id: i64,
    answer: &str,
    is_correct: bool,
    feedback: &str,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO listening_check_attempt
            (listening_check_id, answer, is_correct, feedback, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![listening_check_id, answer, is_correct as i64, feedback, now_ms],
    )?;
    Ok(conn.last_insert_rowid())
}

fn review_item_from_row(row: &rusqlite::Row) -> rusqlite::Result<review::ReviewItem> {
    let item_type: String = row.get(1)?;
    let source: String = row.get(3)?;
    Ok(review::ReviewItem {
        id: row.get(0)?,
        item_type: parse_review_item_type(&item_type)
            .map_err(|error| column_conversion_error(1, error))?,
        content: row.get(2)?,
        source: parse_review_source(&source).map_err(|error| column_conversion_error(3, error))?,
        stage: row.get(4)?,
        next_review_at: row.get(5)?,
        last_reviewed_at: row.get(6)?,
        review_count: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub(crate) fn due_review_items(
    conn: &Connection,
    now_ms: i64,
    limit: i64,
) -> rusqlite::Result<Vec<review::ReviewItem>> {
    let mut statement = conn.prepare(
        "SELECT id, type, content, source, stage, next_review_at, last_reviewed_at, review_count, created_at
         FROM review_item WHERE next_review_at <= ?1 ORDER BY next_review_at ASC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![now_ms, limit], review_item_from_row)?;
    rows.collect()
}

/// One transaction-shaped sequence (this connection has no concurrent
/// writers, so plain sequential statements are sufficient — same principle
/// as `update_repair_event_outcome`'s single-statement simplicity):
/// read the item's current stage, run the pure scheduler, log an append-only
/// `review_event` row, and — unless the outcome was a no-op skip — apply the
/// reschedule to `review_item`.
pub(crate) fn record_review_event_and_reschedule(
    conn: &Connection,
    review_item_id: i64,
    session_id: Option<i64>,
    outcome: ReviewOutcome,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let current_stage: i32 = conn.query_row(
        "SELECT stage FROM review_item WHERE id = ?1",
        params![review_item_id],
        |row| row.get(0),
    )?;

    let rescheduled = review::apply_review_outcome(current_stage, outcome, now_ms);
    let new_stage = rescheduled.map(|(stage, _)| stage).unwrap_or(current_stage);

    conn.execute(
        "INSERT INTO review_event (review_item_id, session_id, outcome, previous_stage, new_stage, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            review_item_id,
            session_id,
            review_outcome_str(outcome),
            current_stage,
            new_stage,
            now_ms,
        ],
    )?;

    if let Some((stage, next_review_at)) = rescheduled {
        conn.execute(
            "UPDATE review_item
             SET stage = ?1, next_review_at = ?2, last_reviewed_at = ?3, review_count = review_count + 1
             WHERE id = ?4",
            params![stage, next_review_at, now_ms, review_item_id],
        )?;
    }

    Ok(())
}

pub(crate) fn recent_review_events(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<review::ReviewEventSummary>> {
    let mut statement = conn.prepare(
        "SELECT re.review_item_id, ri.type, ri.content, re.outcome, re.session_id, re.created_at
         FROM review_event re
         JOIN review_item ri ON ri.id = re.review_item_id
         ORDER BY re.created_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        let item_type: String = row.get(1)?;
        let outcome: String = row.get(3)?;
        Ok(review::ReviewEventSummary {
            review_item_id: row.get(0)?,
            item_type: parse_review_item_type(&item_type)
                .map_err(|error| column_conversion_error(1, error))?,
            content: row.get(2)?,
            outcome: parse_review_outcome(&outcome)
                .map_err(|error| column_conversion_error(3, error))?,
            session_id: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Same recency-limited-window shape as `repair_priority_counts`, filtered
/// to `missed` outcomes only — this is the learner-model "recurrence"
/// signal review outcomes feed back in (see `learner_profile::recurring_issues`).
/// Returns raw review-item-type strings; the caller maps them onto the
/// existing issue-category space via `review::review_type_to_issue_category`.
pub(crate) fn review_missed_counts(
    conn: &Connection,
    recent_limit: i64,
) -> rusqlite::Result<Vec<CategoryCount>> {
    let mut statement = conn.prepare(
        "SELECT type, COUNT(*) as count FROM (
            SELECT ri.type AS type FROM review_event re
            JOIN review_item ri ON ri.id = re.review_item_id
            WHERE re.outcome = 'missed'
            ORDER BY re.created_at DESC
            LIMIT ?1
         )
         GROUP BY type
         ORDER BY count DESC, type ASC",
    )?;
    let rows = statement.query_map(params![recent_limit], |row| {
        Ok(CategoryCount {
            category: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn session_summary_from_row(row: &rusqlite::Row) -> rusqlite::Result<SessionSummary> {
    let status: String = row.get(6)?;
    let difficulty: Option<String> = row.get(7)?;
    let summary_json: Option<String> = row.get(8)?;
    Ok(SessionSummary {
        id: row.get(0)?,
        started_at: row.get(1)?,
        ended_at: row.get(2)?,
        mode: row.get(3)?,
        topic: row.get(4)?,
        turn_count: row.get(5)?,
        status: parse_session_run_status(&status)
            .map_err(|error| column_conversion_error(6, error))?,
        difficulty: difficulty
            .map(|value| parse_cefr_level(&value))
            .transpose()
            .map_err(|error| column_conversion_error(7, error))?,
        summary: summary_json
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| {
                column_conversion_error(8, std::io::Error::new(std::io::ErrorKind::InvalidData, error))
            })?,
        first_user_turn: row.get(9)?,
    })
}

fn recent_sessions(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT s.id, s.started_at, s.ended_at, s.mode, s.topic,
                (SELECT COUNT(*) FROM turn t WHERE t.session_id = s.id AND t.role = 'user') AS turn_count,
                s.status, s.difficulty, s.summary_json,
                (SELECT t.text FROM turn t WHERE t.session_id = s.id AND t.role = 'user'
                 ORDER BY t.timestamp ASC, t.id ASC LIMIT 1) AS first_user_turn
         FROM session s
         ORDER BY s.started_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], session_summary_from_row)?;
    rows.collect()
}

pub(crate) fn category_counts(
    conn: &Connection,
    recent_limit: i64,
) -> rusqlite::Result<Vec<CategoryCount>> {
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

pub(crate) fn recent_expressions(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<ExpressionSummary>> {
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

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRepairEventDetail {
    id: i64,
    priority: RepairPriority,
    issue: String,
    original: String,
    suggested: String,
    micro_explanation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    repair_prompt: Option<String>,
    mode: RepairMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    outcome: Option<RepairOutcome>,
    intensity: RepairIntensity,
    created_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTurnDetail {
    id: i64,
    role: String,
    text: String,
    timestamp: i64,
    corrections: Vec<TutorCorrection>,
    expressions: Vec<BetterExpression>,
    repair_events: Vec<SessionRepairEventDetail>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    id: i64,
    started_at: i64,
    ended_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
    status: SessionRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    difficulty: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_turns: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    continued_from_session_id: Option<i64>,
    turns: Vec<SessionTurnDetail>,
    review_events: Vec<review::ReviewEventSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<super::session::SessionSummaryPayload>,
}

#[allow(clippy::type_complexity)]
fn turns_for_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<(i64, String, String, i64)>> {
    let mut statement = conn.prepare(
        "SELECT id, role, text, timestamp FROM turn
         WHERE session_id = ?1 ORDER BY timestamp ASC, id ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    rows.collect()
}

/// Deliberately tighter than tutor.rs's MAX_HISTORY_MESSAGES (24): a resume
/// re-injects a short recap, not the full rolling window of an
/// already-flowing conversation. Pure and testable independent of the DB.
const RESUME_RECENT_MESSAGE_LIMIT: usize = 12; // last 6 turn pairs

fn recent_tutor_messages(
    turns: &[(i64, String, String, i64)],
    limit: usize,
) -> Vec<TutorMessage> {
    let start = turns.len().saturating_sub(limit);
    turns[start..]
        .iter()
        .filter_map(|(_, role, text, _)| {
            let role = match role.as_str() {
                "user" => Some(TutorMessageRole::User),
                "assistant" => Some(TutorMessageRole::Assistant),
                _ => None,
            }?;
            Some(TutorMessage {
                role,
                content: text.clone(),
            })
        })
        .collect()
}

fn corrections_for_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<(i64, TutorCorrection)>> {
    let mut statement = conn.prepare(
        "SELECT c.turn_id, c.original, c.correction, c.explanation, c.category, c.severity
         FROM correction c
         JOIN turn t ON t.id = c.turn_id
         WHERE t.session_id = ?1
         ORDER BY t.timestamp ASC, t.id ASC, c.id ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        let category: String = row.get(4)?;
        let severity: String = row.get(5)?;
        Ok((
            row.get::<_, i64>(0)?,
            TutorCorrection {
                original: row.get(1)?,
                correction: row.get(2)?,
                explanation: row.get(3)?,
                category: parse_correction_category(&category)
                    .map_err(|error| column_conversion_error(4, error))?,
                severity: parse_correction_severity(&severity)
                    .map_err(|error| column_conversion_error(5, error))?,
            },
        ))
    })?;
    rows.collect()
}

fn expressions_for_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<(i64, BetterExpression)>> {
    let mut statement = conn.prepare(
        "SELECT e.turn_id, e.original, e.suggestion, e.explanation
         FROM expression e
         JOIN turn t ON t.id = e.turn_id
         WHERE t.session_id = ?1
         ORDER BY t.timestamp ASC, t.id ASC, e.id ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            BetterExpression {
                original: row.get(1)?,
                suggestion: row.get(2)?,
                explanation: row.get(3)?,
            },
        ))
    })?;
    rows.collect()
}

fn repair_events_for_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<(i64, SessionRepairEventDetail)>> {
    let mut statement = conn.prepare(
        "SELECT r.turn_id, r.id, r.priority, r.issue, r.original, r.suggested,
                r.micro_explanation, r.repair_prompt, r.mode, r.outcome, r.intensity, r.created_at
         FROM repair_event r
         JOIN turn t ON t.id = r.turn_id
         WHERE t.session_id = ?1
         ORDER BY t.timestamp ASC, t.id ASC, r.id ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        let priority: String = row.get(2)?;
        let mode: String = row.get(8)?;
        let outcome: Option<String> = row.get(9)?;
        let intensity: String = row.get(10)?;
        Ok((
            row.get::<_, i64>(0)?,
            SessionRepairEventDetail {
                id: row.get(1)?,
                priority: parse_repair_priority(&priority)
                    .map_err(|error| column_conversion_error(2, error))?,
                issue: row.get(3)?,
                original: row.get(4)?,
                suggested: row.get(5)?,
                micro_explanation: row.get(6)?,
                repair_prompt: row.get(7)?,
                mode: parse_repair_mode(&mode).map_err(|error| column_conversion_error(8, error))?,
                outcome: outcome
                    .map(|value| parse_repair_outcome(&value))
                    .transpose()
                    .map_err(|error| column_conversion_error(9, error))?,
                intensity: parse_repair_intensity(&intensity)
                    .map_err(|error| column_conversion_error(10, error))?,
                created_at: row.get(11)?,
            },
        ))
    })?;
    rows.collect()
}

fn review_events_for_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<review::ReviewEventSummary>> {
    let mut statement = conn.prepare(
        "SELECT re.review_item_id, ri.type, ri.content, re.outcome, re.session_id, re.created_at
         FROM review_event re
         JOIN review_item ri ON ri.id = re.review_item_id
         WHERE re.session_id = ?1
         ORDER BY re.created_at ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        let item_type: String = row.get(1)?;
        let outcome: String = row.get(3)?;
        Ok(review::ReviewEventSummary {
            review_item_id: row.get(0)?,
            item_type: parse_review_item_type(&item_type)
                .map_err(|error| column_conversion_error(1, error))?,
            content: row.get(2)?,
            outcome: parse_review_outcome(&outcome)
                .map_err(|error| column_conversion_error(3, error))?,
            session_id: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

#[allow(clippy::type_complexity)]
fn session_detail(conn: &Connection, session_id: i64) -> rusqlite::Result<Option<SessionDetail>> {
    let session_row: Option<(
        i64,
        i64,
        i64,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<i64>,
    )> = conn
        .query_row(
            "SELECT id, started_at, ended_at, mode, topic, status, difficulty, target_turns, summary_json, continued_from_session_id
             FROM session WHERE id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .optional()?;

    let Some((
        id,
        started_at,
        ended_at,
        mode,
        topic,
        status_str,
        difficulty_str,
        target_turns,
        summary_json,
        continued_from_session_id,
    )) = session_row
    else {
        return Ok(None);
    };

    let status = parse_session_run_status(&status_str).map_err(|error| column_conversion_error(5, error))?;
    let difficulty = difficulty_str
        .map(|value| parse_cefr_level(&value))
        .transpose()
        .map_err(|error| column_conversion_error(6, error))?;
    let summary = summary_json
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|error| {
            column_conversion_error(8, std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })?;

    let turn_rows = turns_for_session(conn, id)?;
    let mut corrections_by_turn: std::collections::HashMap<i64, Vec<TutorCorrection>> =
        std::collections::HashMap::new();
    for (turn_id, correction) in corrections_for_session(conn, id)? {
        corrections_by_turn.entry(turn_id).or_default().push(correction);
    }
    let mut expressions_by_turn: std::collections::HashMap<i64, Vec<BetterExpression>> =
        std::collections::HashMap::new();
    for (turn_id, expression) in expressions_for_session(conn, id)? {
        expressions_by_turn.entry(turn_id).or_default().push(expression);
    }
    let mut repair_events_by_turn: std::collections::HashMap<i64, Vec<SessionRepairEventDetail>> =
        std::collections::HashMap::new();
    for (turn_id, repair_event) in repair_events_for_session(conn, id)? {
        repair_events_by_turn.entry(turn_id).or_default().push(repair_event);
    }

    let turns = turn_rows
        .into_iter()
        .map(|(turn_id, role, text, timestamp)| SessionTurnDetail {
            id: turn_id,
            role,
            text,
            timestamp,
            corrections: corrections_by_turn.remove(&turn_id).unwrap_or_default(),
            expressions: expressions_by_turn.remove(&turn_id).unwrap_or_default(),
            repair_events: repair_events_by_turn.remove(&turn_id).unwrap_or_default(),
        })
        .collect();

    let review_events = review_events_for_session(conn, id)?;

    Ok(Some(SessionDetail {
        id,
        started_at,
        ended_at,
        mode,
        topic,
        status,
        difficulty,
        target_turns,
        continued_from_session_id,
        turns,
        review_events,
        summary,
    }))
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
) -> Result<i64, HistoryCommandError> {
    let path = db_path(app_handle)?;
    run_blocking(move || {
        let mut conn = open_connection(&path)?;
        let user_turn_id = record_turn_pair(
            &mut conn,
            session_id,
            &transcript,
            &reply,
            &corrections,
            &expressions,
            now_ms(),
        )?;
        Ok(user_turn_id)
    })
    .await
}

#[tauri::command]
pub async fn start_session(
    app_handle: AppHandle,
    request: StartSessionRequest,
) -> Result<SessionStart, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    let StartSessionRequest {
        scenario_id,
        difficulty,
        focus,
        target_turns,
    } = request;
    let session_id = run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(create_session(
            &conn,
            now_ms(),
            scenario_id.as_deref(),
            focus.as_deref(),
            difficulty,
            target_turns,
        )?)
    })
    .await?;
    let context = super::learner_profile::build_session_context(&app_handle).await?;
    Ok(SessionStart {
        session_id,
        learner_context: context.learner_context,
        due_review_items: context.due_review_items,
        listening_profile: context.listening,
    })
}

#[tauri::command]
pub async fn complete_session(
    app_handle: AppHandle,
    request: CompleteSessionRequest,
) -> Result<(), HistoryCommandError> {
    let path = db_path(&app_handle)?;
    let CompleteSessionRequest {
        session_id,
        status,
        summary,
    } = request;
    let summary_json = summary
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| {
            HistoryCommandError::new(
                "history-storage-failed",
                "The session summary could not be saved.",
                error.to_string(),
            )
        })?;
    let review_drafts = summary.map(|summary| summary.review_items).unwrap_or_default();
    run_blocking(move || {
        let conn = open_connection(&path)?;
        complete_session_run(
            &conn,
            session_id,
            status,
            summary_json.as_deref(),
            now_ms(),
        )?;
        let created_at = now_ms();
        for draft in review_drafts {
            if draft.item_type == ReviewItemType::PronunciationTarget {
                insert_pronunciation_target(
                    &conn,
                    &draft.content,
                    PronunciationTargetSource::SessionSummary,
                    None,
                    Some(session_id),
                    created_at,
                )?;
            } else {
                insert_review_item(
                    &conn,
                    draft.item_type,
                    &draft.content,
                    ReviewSource::SessionSummary,
                    None,
                    Some(session_id),
                    None,
                    None,
                    created_at,
                )?;
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn continue_session(
    app_handle: AppHandle,
    request: ContinueSessionRequest,
) -> Result<Option<ConversationResumeContext>, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    let source_session_id = request.session_id;
    let now = now_ms();

    let continuation = run_blocking(move || {
        let conn = open_connection(&path)?;
        Ok(continue_session_run(&conn, source_session_id, now)?)
    })
    .await?;

    let Some(continuation) = continuation else {
        return Ok(None);
    };

    let context = super::learner_profile::build_session_context(&app_handle).await?;
    let learner_context = [
        compose_resume_priority_issues(continuation.prior_summary.as_ref()),
        context.learner_context,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    let learner_context = (!learner_context.is_empty()).then_some(learner_context);

    Ok(Some(ConversationResumeContext {
        source_session_id,
        continuation_session_id: continuation.continuation_session_id,
        recent_messages: continuation.recent_messages,
        prior_summary: continuation.prior_summary,
        learner_context,
        due_review_items: context.due_review_items,
    }))
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
pub async fn get_session_detail(
    app_handle: AppHandle,
    session_id: i64,
) -> Result<Option<SessionDetail>, HistoryCommandError> {
    let path = db_path(&app_handle)?;
    run_blocking(move || Ok(session_detail(&open_connection(&path)?, session_id)?)).await
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
    fn migration_from_version_5_adds_pronunciation_tables_without_touching_existing_data() {
        let (_directory, path) = scratch_db();

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
                CREATE TABLE repair_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL,
                    priority TEXT NOT NULL,
                    issue TEXT NOT NULL,
                    original TEXT NOT NULL,
                    suggested TEXT NOT NULL,
                    micro_explanation TEXT NOT NULL,
                    repair_prompt TEXT,
                    mode TEXT NOT NULL,
                    outcome TEXT,
                    intensity TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    source TEXT NOT NULL,
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    source_assessment_id INTEGER,
                    stage INTEGER NOT NULL DEFAULT 0,
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO review_item (type, content, source, stage, next_review_at, review_count, created_at)
                    VALUES ('grammar_pattern', 'past tense', 'session_summary', 0, 1000, 0, 1000);",
            )
            .expect("v5 review_item table must create");
            conn.pragma_update(None, "user_version", 5)
                .expect("version must set");
        }

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let content: String = conn
            .query_row("SELECT content FROM review_item WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("pre-existing review_item row must survive migration");
        assert_eq!(content, "past tense");

        let target_id = insert_pronunciation_target(
            &conn,
            "I walked to the store",
            PronunciationTargetSource::SessionSummary,
            None,
            None,
            2_000,
        )
        .expect("pronunciation_target must insert after migration");
        assert!(target_id > 0);
    }

    #[test]
    fn migration_from_version_2_adds_session_run_columns_without_touching_existing_data() {
        let (_directory, path) = scratch_db();

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
            .expect("v2 session table must create");
            conn.pragma_update(None, "user_version", 2)
                .expect("version must set");
        }

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let (status, difficulty, target_turns, summary_json): (
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT status, difficulty, target_turns, summary_json FROM session WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("pre-existing session row must survive migration");
        assert_eq!(status, "active");
        assert_eq!(difficulty, None);
        assert_eq!(target_turns, None);
        assert_eq!(summary_json, None);
    }

    #[test]
    fn migration_from_version_7_adds_continued_from_session_id_column_without_touching_existing_data() {
        let (_directory, path) = scratch_db();

        let session_id = {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE session (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER NOT NULL,
                    mode TEXT,
                    topic TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    difficulty TEXT,
                    target_turns INTEGER,
                    summary_json TEXT
                );
                INSERT INTO session (started_at, ended_at) VALUES (1000, 2000);",
            )
            .expect("v7 session table must create");
            let session_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 7)
                .expect("version must set");
            session_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let continued_from_session_id: Option<i64> = conn
            .query_row(
                "SELECT continued_from_session_id FROM session WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("pre-existing session row must survive migration");
        assert_eq!(continued_from_session_id, None);
    }

    #[test]
    fn create_session_persists_scenario_metadata() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(
            &conn,
            1_000,
            Some("daily_standup"),
            Some("focus on past tense"),
            Some(CefrLevel::B1),
            Some(5),
        )
        .expect("session must create");

        let sessions = recent_sessions(&conn, 10).expect("sessions must list");
        let session = sessions.iter().find(|s| s.id == session_id).expect("session must exist");
        assert_eq!(session.mode.as_deref(), Some("daily_standup"));
        assert_eq!(session.topic.as_deref(), Some("focus on past tense"));
        assert_eq!(session.difficulty, Some(CefrLevel::B1));
        assert_eq!(session.status, SessionRunStatus::Active);
    }

    #[test]
    fn complete_session_run_persists_status_and_summary() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, Some("restaurant"), None, None, Some(4))
            .expect("session must create");

        let summary = super::super::session::SessionSummaryPayload {
            what_went_well: vec!["Ordered confidently.".to_string()],
            priority_issues: vec!["past tense accuracy".to_string()],
            alternative_phrases: vec![],
            review_items: vec![review::ReviewItemDraft {
                content: "past tense forms".to_string(),
                item_type: ReviewItemType::GrammarPattern,
            }],
            repair_events: vec![],
        };
        let summary_json = serde_json::to_string(&summary).expect("summary must serialize");

        complete_session_run(
            &conn,
            session_id,
            SessionRunStatus::Completed,
            Some(&summary_json),
            5_000,
        )
        .expect("session must complete");

        let sessions = recent_sessions(&conn, 10).expect("sessions must list");
        let session = sessions.iter().find(|s| s.id == session_id).expect("session must exist");
        assert_eq!(session.status, SessionRunStatus::Completed);
        assert_eq!(session.ended_at, 5_000);
        let persisted_summary = session.summary.as_ref().expect("summary must persist");
        assert_eq!(persisted_summary.priority_issues, vec!["past tense accuracy".to_string()]);
    }

    #[test]
    fn continue_session_run_reuses_active_session_in_place() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, Some("restaurant"), None, None, None)
            .expect("session must create");

        let continuation = continue_session_run(&conn, session_id, 5_000)
            .expect("continue must succeed")
            .expect("session must be found");

        assert_eq!(continuation.continuation_session_id, session_id);
        assert!(continuation.prior_summary.is_none());
        assert!(continuation.recent_messages.is_empty());

        let sessions = recent_sessions(&conn, 10).expect("sessions must list");
        let session = sessions.iter().find(|s| s.id == session_id).expect("session must exist");
        assert_eq!(session.status, SessionRunStatus::Active);
    }

    #[test]
    fn continue_session_run_reactivates_abandoned_session_without_creating_a_new_row() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");
        complete_session_run(&conn, session_id, SessionRunStatus::Abandoned, None, 2_000)
            .expect("session must abandon");

        let continuation = continue_session_run(&conn, session_id, 5_000)
            .expect("continue must succeed")
            .expect("session must be found");

        assert_eq!(continuation.continuation_session_id, session_id);
        assert!(continuation.prior_summary.is_none());

        let status: String = conn
            .query_row(
                "SELECT status FROM session WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("status must read");
        assert_eq!(status, "active");
    }

    #[test]
    fn continue_session_run_creates_linked_session_for_completed_source_and_preserves_original_summary() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(
            &conn,
            1_000,
            Some("restaurant"),
            Some("focus on past tense"),
            Some(CefrLevel::B1),
            Some(5),
        )
        .expect("session must create");

        let summary = super::super::session::SessionSummaryPayload {
            what_went_well: vec!["Ordered confidently.".to_string()],
            priority_issues: vec!["past tense accuracy".to_string()],
            alternative_phrases: vec![],
            review_items: vec![],
            repair_events: vec![],
        };
        let summary_json = serde_json::to_string(&summary).expect("summary must serialize");
        complete_session_run(
            &conn,
            session_id,
            SessionRunStatus::Completed,
            Some(&summary_json),
            3_000,
        )
        .expect("session must complete");

        let before = session_detail(&conn, session_id)
            .expect("detail must query")
            .expect("session must be found");

        let continuation = continue_session_run(&conn, session_id, 9_000)
            .expect("continue must succeed")
            .expect("session must be found");

        assert_ne!(continuation.continuation_session_id, session_id);
        assert_eq!(continuation.prior_summary, Some(summary));

        let after = session_detail(&conn, session_id)
            .expect("detail must query")
            .expect("session must be found");
        assert_eq!(after.status, before.status);
        assert_eq!(after.ended_at, before.ended_at);
        assert_eq!(after.summary, before.summary);

        let new_detail = session_detail(&conn, continuation.continuation_session_id)
            .expect("detail must query")
            .expect("new session must be found");
        assert_eq!(new_detail.status, SessionRunStatus::Active);
        assert_eq!(new_detail.mode.as_deref(), Some("restaurant"));
        assert_eq!(new_detail.topic.as_deref(), Some("focus on past tense"));
        assert_eq!(new_detail.difficulty, Some(CefrLevel::B1));
        assert_eq!(new_detail.target_turns, Some(5));
        assert_eq!(new_detail.continued_from_session_id, Some(session_id));
    }

    #[test]
    fn continue_session_run_returns_none_for_missing_session() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let continuation =
            continue_session_run(&conn, 999, 5_000).expect("continue must not error");
        assert!(continuation.is_none());
    }

    #[test]
    fn continue_session_run_trims_recent_messages_to_last_six_pairs() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");

        for index in 0..8 {
            record_turn_pair(
                &mut conn,
                session_id,
                &format!("user turn {index}"),
                &format!("assistant turn {index}"),
                &[],
                &[],
                2_000 + index,
            )
            .expect("turn pair must record");
        }

        let continuation = continue_session_run(&conn, session_id, 9_000)
            .expect("continue must succeed")
            .expect("session must be found");

        assert_eq!(continuation.recent_messages.len(), 12);
        assert_eq!(continuation.recent_messages[0].content, "user turn 2");
        assert_eq!(continuation.recent_messages[1].content, "assistant turn 2");
        assert_eq!(
            continuation.recent_messages[11].content,
            "assistant turn 7"
        );
    }

    #[test]
    fn compose_resume_priority_issues_is_none_when_prior_summary_absent() {
        assert_eq!(compose_resume_priority_issues(None), None);
    }

    #[test]
    fn compose_resume_priority_issues_is_none_when_priority_issues_empty() {
        let summary = super::super::session::SessionSummaryPayload {
            what_went_well: vec![],
            priority_issues: vec![],
            alternative_phrases: vec![],
            review_items: vec![],
            repair_events: vec![],
        };
        assert_eq!(compose_resume_priority_issues(Some(&summary)), None);
    }

    #[test]
    fn compose_resume_priority_issues_joins_up_to_three_issues() {
        let summary = super::super::session::SessionSummaryPayload {
            what_went_well: vec![],
            priority_issues: vec![
                "past tense accuracy".to_string(),
                "article usage".to_string(),
            ],
            alternative_phrases: vec![],
            review_items: vec![],
            repair_events: vec![],
        };
        let blurb = compose_resume_priority_issues(Some(&summary)).expect("blurb must be present");
        assert!(blurb.contains("past tense accuracy"));
        assert!(blurb.contains("article usage"));
    }

    #[test]
    fn record_turn_pair_links_corrections_to_user_turn_and_expressions_to_assistant_turn() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, None, None, None, None).expect("session must create");

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
    fn insert_repair_event_update_outcome_and_repair_priority_counts_round_trip() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, None, None, None, None).expect("session must create");
        let user_turn_id = record_turn_pair(
            &mut conn,
            session_id,
            "Yesterday I go to the office",
            "Nice, what did you work on?",
            &[],
            &[],
            2_000,
        )
        .expect("turn pair must record");

        let event_id = insert_repair_event(
            &conn,
            user_turn_id,
            RepairPriority::Grammar,
            "past tense form",
            "Yesterday I go to the office",
            "Yesterday I went to the office",
            "Use past tense for a finished action.",
            Some("Try that sentence again using 'went'."),
            RepairMode::Repair,
            RepairIntensity::Balanced,
            2_500,
        )
        .expect("repair event must insert");

        let outcome: Option<String> = conn
            .query_row(
                "SELECT outcome FROM repair_event WHERE id = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .expect("repair event must exist");
        assert_eq!(outcome, None);

        update_repair_event_outcome(&conn, event_id, RepairOutcome::Improved)
            .expect("outcome must update");

        let outcome: Option<String> = conn
            .query_row(
                "SELECT outcome FROM repair_event WHERE id = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .expect("repair event must exist");
        assert_eq!(outcome, Some("improved".to_string()));

        let counts = repair_priority_counts(&conn, 50).expect("counts must compute");
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].category, "grammar");
        assert_eq!(counts[0].count, 1);
    }

    #[test]
    fn pronunciation_target_attempt_and_promotion_round_trip() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let target_id = insert_pronunciation_target(
            &conn,
            "I walked to the store",
            PronunciationTargetSource::SessionSummary,
            None,
            None,
            1_000,
        )
        .expect("target must insert");

        let core = pronunciation_target_core(&conn, target_id)
            .expect("query must succeed")
            .expect("target must exist");
        assert_eq!(core.phrase, "I walked to the store");
        assert_eq!(core.review_item_id, None);

        insert_pronunciation_attempt(
            &conn,
            target_id,
            None,
            "I walk to the store",
            false,
            Some(PronunciationProblemCategory::FinalConsonants),
            "[]",
            "Try fully pronouncing the ending of \"walked\".",
            1_500,
        )
        .expect("attempt must insert");

        // First mismatch is the "real problem" signal that promotes the
        // target into spaced retrieval — mirrors what submit_pronunciation_attempt does.
        let review_item_id = insert_review_item(
            &conn,
            ReviewItemType::PronunciationTarget,
            &core.phrase,
            ReviewSource::SessionSummary,
            None,
            None,
            None,
            Some(target_id),
            1_500,
        )
        .expect("review item must insert");
        set_pronunciation_target_review_item(&conn, target_id, review_item_id)
            .expect("target must link to review item");

        let targets = list_pronunciation_targets_with_stats(&conn, 10).expect("targets must list");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].attempt_count, 1);
        assert!(targets[0].is_promoted);

        let unresolved =
            recent_unresolved_pronunciation_targets(&conn, 10).expect("unresolved must list");
        assert_eq!(unresolved, vec!["I walked to the store".to_string()]);

        insert_pronunciation_attempt(
            &conn,
            target_id,
            None,
            "I walked to the store",
            true,
            None,
            "[]",
            "Nice and clear.",
            2_000,
        )
        .expect("second attempt must insert");

        let unresolved_after_success =
            recent_unresolved_pronunciation_targets(&conn, 10).expect("unresolved must list");
        assert!(unresolved_after_success.is_empty());
    }

    #[test]
    fn migration_from_version_6_adds_listening_tables_without_touching_existing_data() {
        let (_directory, path) = scratch_db();

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
                CREATE TABLE pronunciation_target (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phrase TEXT NOT NULL,
                    source TEXT NOT NULL,
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    review_item_id INTEGER,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO pronunciation_target (phrase, source, created_at)
                    VALUES ('I walked to the store', 'session_summary', 1000);",
            )
            .expect("v6 pronunciation_target table must create");
            conn.pragma_update(None, "user_version", 6)
                .expect("version must set");
        }

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let phrase: String = conn
            .query_row(
                "SELECT phrase FROM pronunciation_target WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("pre-existing pronunciation_target row must survive migration");
        assert_eq!(phrase, "I walked to the store");

        let check_id = insert_listening_check(
            &conn,
            None,
            "The train leaves at six.",
            ListeningCheckType::DetailQuestion,
            "What time does the train leave?",
            None,
            None,
            Some("six o'clock / 6"),
            0,
            2_000,
        )
        .expect("listening_check must insert after migration");
        assert!(check_id > 0);
    }

    #[test]
    fn listening_check_and_attempt_round_trip() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let check_id = insert_listening_check(
            &conn,
            None,
            "We should meet at the cafe on Elm Street around noon.",
            ListeningCheckType::SummaryChoice,
            "Which summary is accurate?",
            Some(r#"["They will meet at noon.","They will meet in the evening.","They cancelled the meeting."]"#),
            Some(0),
            None,
            1,
            1_000,
        )
        .expect("check must insert");

        let core = listening_check_core(&conn, check_id)
            .expect("query must succeed")
            .expect("check must exist");
        assert_eq!(core.check_type, ListeningCheckType::SummaryChoice);
        assert_eq!(core.options.len(), 3);
        assert_eq!(core.correct_option_index, Some(0));

        let attempt_id = insert_listening_check_attempt(
            &conn,
            check_id,
            "They will meet at noon.",
            true,
            "Correct.",
            1_500,
        )
        .expect("attempt must insert");
        assert!(attempt_id > 0);
    }

    #[test]
    fn category_counts_apply_minimum_threshold_ordering() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, None, None, None, None).expect("session must create");

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

        let counts = category_counts(&conn, 50).expect("counts must compute");
        assert_eq!(counts[0].category, "grammar");
        assert_eq!(counts[0].count, 2);
    }

    #[test]
    fn recent_sessions_reports_user_turn_count_and_touched_ended_at() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id = create_session(&conn, 1_000, None, None, None, None).expect("session must create");
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
    fn recent_sessions_includes_first_user_turn() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let with_turn =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");
        record_turn_pair(&mut conn, with_turn, "hello there", "hi!", &[], &[], 2_000)
            .expect("turn pair must record");
        let without_turn =
            create_session(&conn, 500, None, None, None, None).expect("session must create");

        let sessions = recent_sessions(&conn, 10).expect("sessions must list");
        let with_turn_summary = sessions.iter().find(|s| s.id == with_turn).unwrap();
        let without_turn_summary = sessions.iter().find(|s| s.id == without_turn).unwrap();
        assert_eq!(with_turn_summary.first_user_turn.as_deref(), Some("hello there"));
        assert_eq!(without_turn_summary.first_user_turn, None);
    }

    #[test]
    fn session_detail_returns_none_for_missing_session() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        assert_eq!(session_detail(&conn, 999).expect("query must succeed"), None);
    }

    #[test]
    fn session_detail_handles_session_with_no_turns_and_no_summary() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");

        let detail = session_detail(&conn, session_id)
            .expect("query must succeed")
            .expect("session must be found");
        assert_eq!(detail.status, SessionRunStatus::Active);
        assert!(detail.turns.is_empty());
        assert!(detail.review_events.is_empty());
        assert_eq!(detail.summary, None);

        // The frontend's SessionDetail type declares `turns` and
        // `reviewEvents` as required (non-optional) arrays — serde must
        // never omit these keys just because they're empty, or the
        // frontend receives `undefined` instead of `[]` and crashes on
        // `.length`.
        let json = serde_json::to_value(&detail).expect("detail must serialize");
        assert!(json.get("turns").is_some_and(|value| value.is_array()));
        assert!(json.get("reviewEvents").is_some_and(|value| value.is_array()));
    }

    #[test]
    fn session_detail_includes_turns_corrections_expressions_repair_events_in_order() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");
        let session_id =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");

        let first_correction = correction(CorrectionCategory::Grammar, CorrectionSeverity::Minor);
        let first_expression = expression("I agree");
        let first_user_turn_id = record_turn_pair(
            &mut conn,
            session_id,
            "first user turn",
            "first assistant turn",
            std::slice::from_ref(&first_correction),
            std::slice::from_ref(&first_expression),
            2_000,
        )
        .expect("first turn pair must record");

        record_turn_pair(
            &mut conn,
            session_id,
            "second user turn",
            "second assistant turn",
            &[],
            &[],
            3_000,
        )
        .expect("second turn pair must record");

        insert_repair_event(
            &conn,
            first_user_turn_id,
            RepairPriority::Grammar,
            "issue",
            "original",
            "suggested",
            "micro explanation",
            None,
            RepairMode::Quick,
            RepairIntensity::Balanced,
            2_500,
        )
        .expect("repair event must insert");

        let detail = session_detail(&conn, session_id)
            .expect("query must succeed")
            .expect("session must be found");

        assert_eq!(detail.turns.len(), 4);
        assert_eq!(detail.turns[0].text, "first user turn");
        assert_eq!(detail.turns[1].text, "first assistant turn");
        assert_eq!(detail.turns[2].text, "second user turn");
        assert_eq!(detail.turns[3].text, "second assistant turn");

        assert_eq!(detail.turns[0].corrections, vec![first_correction]);
        assert!(detail.turns[1].corrections.is_empty());
        assert_eq!(detail.turns[1].expressions, vec![first_expression]);
        assert!(detail.turns[0].expressions.is_empty());

        assert_eq!(detail.turns[0].repair_events.len(), 1);
        assert_eq!(detail.turns[0].repair_events[0].issue, "issue");
        assert_eq!(detail.turns[0].repair_events[0].outcome, None);
        assert!(detail.turns[2].repair_events.is_empty());

        // A turn with no corrections/expressions/repair events must still
        // serialize those keys as `[]`, not omit them — the frontend's
        // SessionTurnDetail type declares all three as required arrays.
        let json = serde_json::to_value(&detail).expect("detail must serialize");
        let second_user_turn = &json["turns"][2];
        assert!(second_user_turn["corrections"].is_array());
        assert!(second_user_turn["expressions"].is_array());
        assert!(second_user_turn["repairEvents"].is_array());
    }

    #[test]
    fn session_detail_includes_review_events_and_summary_json() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");
        let session_id =
            create_session(&conn, 1_000, None, None, None, None).expect("session must create");

        let summary = super::super::session::SessionSummaryPayload {
            what_went_well: vec!["Good pacing".into()],
            priority_issues: vec![],
            alternative_phrases: vec![],
            review_items: vec![],
            repair_events: vec![],
        };
        let summary_json = serde_json::to_string(&summary).expect("summary must serialize");
        complete_session_run(
            &conn,
            session_id,
            SessionRunStatus::Completed,
            Some(&summary_json),
            4_000,
        )
        .expect("session must complete");

        let review_item_id = insert_review_item(
            &conn,
            ReviewItemType::Vocabulary,
            "a phrase to review",
            ReviewSource::SessionSummary,
            None,
            Some(session_id),
            None,
            None,
            4_000,
        )
        .expect("review item must insert");
        record_review_event_and_reschedule(
            &conn,
            review_item_id,
            Some(session_id),
            ReviewOutcome::Remembered,
            5_000,
        )
        .expect("review event must record");

        let detail = session_detail(&conn, session_id)
            .expect("query must succeed")
            .expect("session must be found");

        assert_eq!(detail.status, SessionRunStatus::Completed);
        assert_eq!(detail.summary, Some(summary));
        assert_eq!(detail.review_events.len(), 1);
        assert_eq!(detail.review_events[0].review_item_id, review_item_id);
        assert_eq!(detail.review_events[0].outcome, ReviewOutcome::Remembered);
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
