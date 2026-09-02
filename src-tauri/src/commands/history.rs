use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::assessment::{cefr_level_str, competency_label, AssessmentCompetency, CefrLevel};
use super::chunk::{self, ChunkCandidateInput, ChunkOrigin, ExerciseType, LexicalChunkType, Modality, ProductiveStatus};
use super::dictionary::{self, DictionaryContextTag};
use super::listening::ListeningCheckType;
use super::pronunciation::{self, PronunciationProblemCategory, PronunciationTargetSource};
use super::reading;
use super::repair::{RepairIntensity, RepairMode, RepairOutcome, RepairPriority};
use super::review::{self, ReviewItemType, ReviewOutcome, ReviewSource};
use super::writing::{
    self, WritingDimension, WritingEvaluationRecord, WritingEvaluationStage, WritingTaskStatus,
    WritingTaskType,
};
use super::tutor::{
    BetterExpression, CorrectionCategory, CorrectionSeverity, TutorCorrection, TutorMessage,
    TutorMessageRole,
};

const DB_FILE_NAME: &str = "history.sqlite3";
const SCHEMA_VERSION: i32 = 16;
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
    pub(crate) id: i64,
    pub(crate) started_at: i64,
    pub(crate) ended_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) topic: Option<String>,
    pub(crate) turn_count: i64,
    pub(crate) status: SessionRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) difficulty: Option<CefrLevel>,
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
        CorrectionCategory::Cohesion => "cohesion",
        CorrectionCategory::Register => "register",
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
        "cohesion" => Ok(CorrectionCategory::Cohesion),
        "register" => Ok(CorrectionCategory::Register),
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
        ReviewSource::WritingTask => "writing_task",
        ReviewSource::Chunk => "chunk",
        ReviewSource::ReadingSession => "reading_session",
    }
}

fn parse_review_source(value: &str) -> Result<ReviewSource, std::io::Error> {
    match value {
        "repair_event" => Ok(ReviewSource::RepairEvent),
        "session_summary" => Ok(ReviewSource::SessionSummary),
        "assessment_priority" => Ok(ReviewSource::AssessmentPriority),
        "writing_task" => Ok(ReviewSource::WritingTask),
        "chunk" => Ok(ReviewSource::Chunk),
        "reading_session" => Ok(ReviewSource::ReadingSession),
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

fn writing_task_type_str(task_type: WritingTaskType) -> &'static str {
    match task_type {
        WritingTaskType::ProfessionalEmail => "professional_email",
        WritingTaskType::OpinionParagraph => "opinion_paragraph",
        WritingTaskType::TechnicalExplanation => "technical_explanation",
        WritingTaskType::Summary => "summary",
        WritingTaskType::Recommendation => "recommendation",
        WritingTaskType::ShortArgument => "short_argument",
    }
}

fn parse_writing_task_type(value: &str) -> Result<WritingTaskType, std::io::Error> {
    match value {
        "professional_email" => Ok(WritingTaskType::ProfessionalEmail),
        "opinion_paragraph" => Ok(WritingTaskType::OpinionParagraph),
        "technical_explanation" => Ok(WritingTaskType::TechnicalExplanation),
        "summary" => Ok(WritingTaskType::Summary),
        "recommendation" => Ok(WritingTaskType::Recommendation),
        "short_argument" => Ok(WritingTaskType::ShortArgument),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown writing task type: {other}"),
        )),
    }
}

fn parse_writing_task_status(value: &str) -> Result<WritingTaskStatus, std::io::Error> {
    match value {
        "drafting" => Ok(WritingTaskStatus::Drafting),
        "draft_evaluated" => Ok(WritingTaskStatus::DraftEvaluated),
        "rewrite_evaluated" => Ok(WritingTaskStatus::RewriteEvaluated),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown writing task status: {other}"),
        )),
    }
}

fn writing_evaluation_stage_str(stage: WritingEvaluationStage) -> &'static str {
    match stage {
        WritingEvaluationStage::Draft => "draft",
        WritingEvaluationStage::Rewrite => "rewrite",
    }
}

fn writing_dimension_str(dimension: WritingDimension) -> &'static str {
    match dimension {
        WritingDimension::TaskAchievement => "task_achievement",
        WritingDimension::CoherenceCohesion => "coherence_cohesion",
        WritingDimension::LexicalResource => "lexical_resource",
        WritingDimension::Grammar => "grammar",
        WritingDimension::RegisterTone => "register_tone",
    }
}

fn parse_writing_dimension(value: &str) -> Result<WritingDimension, std::io::Error> {
    match value {
        "task_achievement" => Ok(WritingDimension::TaskAchievement),
        "coherence_cohesion" => Ok(WritingDimension::CoherenceCohesion),
        "lexical_resource" => Ok(WritingDimension::LexicalResource),
        "grammar" => Ok(WritingDimension::Grammar),
        "register_tone" => Ok(WritingDimension::RegisterTone),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown writing dimension: {other}"),
        )),
    }
}

fn parse_reading_session_status(value: &str) -> Result<reading::ReadingSessionStatus, std::io::Error> {
    match value {
        "reading" => Ok(reading::ReadingSessionStatus::Reading),
        "comprehension_answered" => Ok(reading::ReadingSessionStatus::ComprehensionAnswered),
        "chunks_selected" => Ok(reading::ReadingSessionStatus::ChunksSelected),
        "summary_submitted" => Ok(reading::ReadingSessionStatus::SummarySubmitted),
        "evaluated" => Ok(reading::ReadingSessionStatus::Evaluated),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown reading session status: {other}"),
        )),
    }
}

fn summary_fidelity_str(fidelity: reading::SummaryFidelity) -> &'static str {
    match fidelity {
        reading::SummaryFidelity::Faithful => "faithful",
        reading::SummaryFidelity::PartiallyFaithful => "partially_faithful",
        reading::SummaryFidelity::Unfaithful => "unfaithful",
    }
}

fn parse_summary_fidelity(value: &str) -> Result<reading::SummaryFidelity, std::io::Error> {
    match value {
        "faithful" => Ok(reading::SummaryFidelity::Faithful),
        "partially_faithful" => Ok(reading::SummaryFidelity::PartiallyFaithful),
        "unfaithful" => Ok(reading::SummaryFidelity::Unfaithful),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown summary fidelity: {other}"),
        )),
    }
}

fn response_relevance_str(relevance: reading::ResponseRelevance) -> &'static str {
    match relevance {
        reading::ResponseRelevance::Relevant => "relevant",
        reading::ResponseRelevance::PartiallyRelevant => "partially_relevant",
        reading::ResponseRelevance::OffTopic => "off_topic",
    }
}

fn parse_response_relevance(value: &str) -> Result<reading::ResponseRelevance, std::io::Error> {
    match value {
        "relevant" => Ok(reading::ResponseRelevance::Relevant),
        "partially_relevant" => Ok(reading::ResponseRelevance::PartiallyRelevant),
        "off_topic" => Ok(reading::ResponseRelevance::OffTopic),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown response relevance: {other}"),
        )),
    }
}

fn reading_issue_category_str(category: reading::ReadingIssueCategory) -> &'static str {
    match category {
        reading::ReadingIssueCategory::Summary => "summary",
        reading::ReadingIssueCategory::Response => "response",
    }
}

fn parse_reading_issue_category(value: &str) -> Result<reading::ReadingIssueCategory, std::io::Error> {
    match value {
        "summary" => Ok(reading::ReadingIssueCategory::Summary),
        "response" => Ok(reading::ReadingIssueCategory::Response),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown reading issue category: {other}"),
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

    if current_version < 9 {
        conn.execute_batch(
            "ALTER TABLE turn ADD COLUMN origin TEXT NOT NULL DEFAULT 'spoken'
                CHECK (origin IN ('spoken', 'typed'));",
        )?;
    }

    if current_version < 10 {
        conn.execute_batch(
            "CREATE TABLE correction_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                original TEXT NOT NULL,
                correction TEXT NOT NULL,
                explanation TEXT NOT NULL,
                category TEXT NOT NULL CHECK (category IN (
                    'grammar', 'vocabulary', 'naturalness', 'clarity', 'cohesion', 'register'
                )),
                severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
            );
            INSERT INTO correction_new SELECT * FROM correction;
            DROP TABLE correction;
            ALTER TABLE correction_new RENAME TO correction;
            CREATE INDEX IF NOT EXISTS idx_correction_turn ON correction(turn_id);
            CREATE INDEX IF NOT EXISTS idx_correction_category ON correction(category);",
        )?;
    }

    if current_version < 11 {
        conn.execute_batch(
            "CREATE TABLE writing_task (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT NOT NULL CHECK (task_type IN (
                    'professional_email', 'opinion_paragraph', 'technical_explanation',
                    'summary', 'recommendation', 'short_argument'
                )),
                target_level TEXT NOT NULL CHECK (target_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                draft_text TEXT,
                draft_submitted_at INTEGER,
                rewrite_text TEXT,
                rewrite_submitted_at INTEGER,
                status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN (
                    'drafting', 'draft_evaluated', 'rewrite_evaluated'
                )),
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_writing_task_created_at ON writing_task(created_at);

            CREATE TABLE writing_evaluation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                writing_task_id INTEGER NOT NULL REFERENCES writing_task(id) ON DELETE CASCADE,
                stage TEXT NOT NULL CHECK (stage IN ('draft', 'rewrite')),
                overall_level TEXT NOT NULL CHECK (overall_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                rewrite_instruction TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_writing_evaluation_task ON writing_evaluation(writing_task_id);

            CREATE TABLE writing_dimension_score (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                writing_evaluation_id INTEGER NOT NULL REFERENCES writing_evaluation(id) ON DELETE CASCADE,
                dimension TEXT NOT NULL CHECK (dimension IN (
                    'task_achievement', 'coherence_cohesion', 'lexical_resource', 'grammar', 'register_tone'
                )),
                level TEXT NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
                evidence TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_writing_dimension_score_evaluation ON writing_dimension_score(writing_evaluation_id);

            CREATE TABLE writing_priority_issue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                writing_evaluation_id INTEGER NOT NULL REFERENCES writing_evaluation(id) ON DELETE CASCADE,
                category TEXT NOT NULL,
                original TEXT NOT NULL,
                suggested TEXT NOT NULL,
                explanation TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_writing_priority_issue_evaluation ON writing_priority_issue(writing_evaluation_id);

            CREATE TABLE writing_useful_chunk (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                writing_evaluation_id INTEGER NOT NULL REFERENCES writing_evaluation(id) ON DELETE CASCADE,
                chunk TEXT NOT NULL,
                register TEXT NOT NULL,
                example TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_writing_useful_chunk_evaluation ON writing_useful_chunk(writing_evaluation_id);

            PRAGMA foreign_keys = OFF;

            CREATE TABLE review_item_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK (type IN (
                    'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                )),
                content TEXT NOT NULL,
                source TEXT NOT NULL CHECK (source IN (
                    'repair_event', 'session_summary', 'assessment_priority', 'writing_task'
                )),
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                source_assessment_id INTEGER REFERENCES assessment(id) ON DELETE SET NULL,
                source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL,
                source_writing_task_id INTEGER REFERENCES writing_task(id) ON DELETE SET NULL,
                stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                next_review_at INTEGER NOT NULL,
                last_reviewed_at INTEGER,
                review_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            INSERT INTO review_item_new
                (id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                 source_pronunciation_target_id, source_writing_task_id, stage, next_review_at, last_reviewed_at,
                 review_count, created_at)
            SELECT
                id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                source_pronunciation_target_id, NULL, stage, next_review_at, last_reviewed_at,
                review_count, created_at
            FROM review_item;
            DROP TABLE review_item;
            ALTER TABLE review_item_new RENAME TO review_item;
            CREATE INDEX IF NOT EXISTS idx_review_item_next_review_at ON review_item(next_review_at);
            CREATE INDEX IF NOT EXISTS idx_review_item_type ON review_item(type);

            PRAGMA foreign_keys = ON;",
        )?;
    }

    if current_version < 12 {
        conn.execute_batch(
            "CREATE TABLE lexical_chunk (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_type TEXT NOT NULL CHECK (chunk_type IN (
                    'single_word', 'collocation', 'phrase', 'discourse_marker',
                    'hedging_expression', 'stance_phrase', 'register_specific_expression',
                    'domain_specific_expression'
                )),
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                register TEXT NOT NULL,
                target_level TEXT NOT NULL CHECK (target_level IN ('A1','A2','B1','B2','C1','C2')),
                domain TEXT,
                examples_json TEXT NOT NULL,
                common_error TEXT,
                origin TEXT NOT NULL CHECK (origin IN (
                    'correction', 'better_expression', 'repair_event', 'writing_task', 'manual'
                )),
                source_correction_id INTEGER REFERENCES correction(id) ON DELETE SET NULL,
                source_expression_id INTEGER REFERENCES expression(id) ON DELETE SET NULL,
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_writing_evaluation_id INTEGER REFERENCES writing_evaluation(id) ON DELETE SET NULL,
                productive_status TEXT NOT NULL DEFAULT 'not_tried' CHECK (productive_status IN (
                    'not_tried', 'recognized', 'used_with_help', 'used_independently', 'automatic'
                )),
                review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_lexical_chunk_normalized_text ON lexical_chunk(normalized_text);
            CREATE INDEX IF NOT EXISTS idx_lexical_chunk_status ON lexical_chunk(productive_status);

            CREATE TABLE lexical_chunk_attempt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lexical_chunk_id INTEGER NOT NULL REFERENCES lexical_chunk(id) ON DELETE CASCADE,
                exercise_type TEXT NOT NULL CHECK (exercise_type IN (
                    'use_in_sentence', 'complete_response', 'rewrite_sentence',
                    'spoken_response', 'mini_paragraph'
                )),
                modality TEXT NOT NULL CHECK (modality IN ('written', 'spoken')),
                prompt TEXT NOT NULL,
                transcript TEXT NOT NULL,
                outcome TEXT NOT NULL CHECK (outcome IN ('remembered', 'partially_remembered', 'missed', 'skipped')),
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lexical_chunk_attempt_chunk ON lexical_chunk_attempt(lexical_chunk_id, created_at);

            PRAGMA foreign_keys = OFF;

            CREATE TABLE review_item_v12 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK (type IN (
                    'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                )),
                content TEXT NOT NULL,
                source TEXT NOT NULL CHECK (source IN (
                    'repair_event', 'session_summary', 'assessment_priority', 'writing_task', 'chunk'
                )),
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                source_assessment_id INTEGER REFERENCES assessment(id) ON DELETE SET NULL,
                source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL,
                source_writing_task_id INTEGER REFERENCES writing_task(id) ON DELETE SET NULL,
                source_chunk_id INTEGER REFERENCES lexical_chunk(id) ON DELETE SET NULL,
                stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                next_review_at INTEGER NOT NULL,
                last_reviewed_at INTEGER,
                review_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            INSERT INTO review_item_v12
                (id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                 source_pronunciation_target_id, source_writing_task_id, source_chunk_id, stage, next_review_at,
                 last_reviewed_at, review_count, created_at)
            SELECT
                id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                source_pronunciation_target_id, source_writing_task_id, NULL, stage, next_review_at,
                last_reviewed_at, review_count, created_at
            FROM review_item;
            DROP TABLE review_item;
            ALTER TABLE review_item_v12 RENAME TO review_item;
            CREATE INDEX IF NOT EXISTS idx_review_item_next_review_at ON review_item(next_review_at);
            CREATE INDEX IF NOT EXISTS idx_review_item_type ON review_item(type);

            PRAGMA foreign_keys = ON;",
        )?;
    }

    if current_version < 13 {
        conn.execute_batch(
            "CREATE TABLE reading_session_attempt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN (
                    'reading', 'comprehension_answered', 'chunks_selected', 'summary_submitted', 'evaluated'
                )),
                comprehension_correct INTEGER CHECK (comprehension_correct IN (0, 1)),
                comprehension_answered_at INTEGER,
                selected_chunk_ids_json TEXT,
                summary_text TEXT,
                response_text TEXT,
                production_submitted_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_reading_session_attempt_text ON reading_session_attempt(text_id);
            CREATE INDEX IF NOT EXISTS idx_reading_session_attempt_created_at ON reading_session_attempt(created_at);

            CREATE TABLE reading_session_evaluation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_session_attempt_id INTEGER NOT NULL REFERENCES reading_session_attempt(id) ON DELETE CASCADE,
                summary_fidelity TEXT NOT NULL CHECK (summary_fidelity IN ('faithful', 'partially_faithful', 'unfaithful')),
                response_relevance TEXT NOT NULL CHECK (response_relevance IN ('relevant', 'partially_relevant', 'off_topic')),
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_reading_session_evaluation_attempt ON reading_session_evaluation(reading_session_attempt_id);

            CREATE TABLE reading_session_priority_issue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_session_evaluation_id INTEGER NOT NULL REFERENCES reading_session_evaluation(id) ON DELETE CASCADE,
                category TEXT NOT NULL,
                original TEXT NOT NULL,
                suggested TEXT NOT NULL,
                explanation TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_reading_session_priority_issue_evaluation ON reading_session_priority_issue(reading_session_evaluation_id);

            CREATE TABLE reading_session_useful_chunk (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_session_evaluation_id INTEGER NOT NULL REFERENCES reading_session_evaluation(id) ON DELETE CASCADE,
                chunk TEXT NOT NULL,
                register TEXT NOT NULL,
                example TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_reading_session_useful_chunk_evaluation ON reading_session_useful_chunk(reading_session_evaluation_id);

            PRAGMA foreign_keys = OFF;

            CREATE TABLE lexical_chunk_v13 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_type TEXT NOT NULL CHECK (chunk_type IN (
                    'single_word', 'collocation', 'phrase', 'discourse_marker',
                    'hedging_expression', 'stance_phrase', 'register_specific_expression',
                    'domain_specific_expression'
                )),
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                register TEXT NOT NULL,
                target_level TEXT NOT NULL CHECK (target_level IN ('A1','A2','B1','B2','C1','C2')),
                domain TEXT,
                examples_json TEXT NOT NULL,
                common_error TEXT,
                origin TEXT NOT NULL CHECK (origin IN (
                    'correction', 'better_expression', 'repair_event', 'writing_task', 'reading_session', 'manual'
                )),
                source_correction_id INTEGER REFERENCES correction(id) ON DELETE SET NULL,
                source_expression_id INTEGER REFERENCES expression(id) ON DELETE SET NULL,
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_writing_evaluation_id INTEGER REFERENCES writing_evaluation(id) ON DELETE SET NULL,
                source_reading_session_attempt_id INTEGER REFERENCES reading_session_attempt(id) ON DELETE SET NULL,
                productive_status TEXT NOT NULL DEFAULT 'not_tried' CHECK (productive_status IN (
                    'not_tried', 'recognized', 'used_with_help', 'used_independently', 'automatic'
                )),
                review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            INSERT INTO lexical_chunk_v13
                (id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                 common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                 source_writing_evaluation_id, source_reading_session_attempt_id, productive_status,
                 review_item_id, last_used_at, created_at)
            SELECT
                id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                source_writing_evaluation_id, NULL, productive_status,
                review_item_id, last_used_at, created_at
            FROM lexical_chunk;
            DROP TABLE lexical_chunk;
            ALTER TABLE lexical_chunk_v13 RENAME TO lexical_chunk;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_lexical_chunk_normalized_text ON lexical_chunk(normalized_text);
            CREATE INDEX IF NOT EXISTS idx_lexical_chunk_status ON lexical_chunk(productive_status);

            CREATE TABLE review_item_v13 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK (type IN (
                    'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                )),
                content TEXT NOT NULL,
                source TEXT NOT NULL CHECK (source IN (
                    'repair_event', 'session_summary', 'assessment_priority', 'writing_task', 'chunk', 'reading_session'
                )),
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                source_assessment_id INTEGER REFERENCES assessment(id) ON DELETE SET NULL,
                source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL,
                source_writing_task_id INTEGER REFERENCES writing_task(id) ON DELETE SET NULL,
                source_chunk_id INTEGER REFERENCES lexical_chunk(id) ON DELETE SET NULL,
                source_reading_session_attempt_id INTEGER REFERENCES reading_session_attempt(id) ON DELETE SET NULL,
                stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                next_review_at INTEGER NOT NULL,
                last_reviewed_at INTEGER,
                review_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            INSERT INTO review_item_v13
                (id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                 source_pronunciation_target_id, source_writing_task_id, source_chunk_id,
                 source_reading_session_attempt_id, stage, next_review_at,
                 last_reviewed_at, review_count, created_at)
            SELECT
                id, type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
                source_pronunciation_target_id, source_writing_task_id, source_chunk_id,
                NULL, stage, next_review_at,
                last_reviewed_at, review_count, created_at
            FROM review_item;
            DROP TABLE review_item;
            ALTER TABLE review_item_v13 RENAME TO review_item;
            CREATE INDEX IF NOT EXISTS idx_review_item_next_review_at ON review_item(next_review_at);
            CREATE INDEX IF NOT EXISTS idx_review_item_type ON review_item(type);

            PRAGMA foreign_keys = ON;",
        )?;
    }

    if current_version < 14 {
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;

            CREATE TABLE lexical_chunk_v14 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_type TEXT NOT NULL CHECK (chunk_type IN (
                    'single_word', 'collocation', 'phrase', 'discourse_marker',
                    'hedging_expression', 'stance_phrase', 'register_specific_expression',
                    'domain_specific_expression'
                )),
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                register TEXT NOT NULL,
                target_level TEXT NOT NULL CHECK (target_level IN ('A1','A2','B1','B2','C1','C2')),
                domain TEXT,
                examples_json TEXT NOT NULL,
                common_error TEXT,
                origin TEXT NOT NULL CHECK (origin IN (
                    'correction', 'better_expression', 'repair_event', 'writing_task', 'reading_session',
                    'manual', 'scenario_pack'
                )),
                source_correction_id INTEGER REFERENCES correction(id) ON DELETE SET NULL,
                source_expression_id INTEGER REFERENCES expression(id) ON DELETE SET NULL,
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_writing_evaluation_id INTEGER REFERENCES writing_evaluation(id) ON DELETE SET NULL,
                source_reading_session_attempt_id INTEGER REFERENCES reading_session_attempt(id) ON DELETE SET NULL,
                source_scenario_pack_id TEXT,
                productive_status TEXT NOT NULL DEFAULT 'not_tried' CHECK (productive_status IN (
                    'not_tried', 'recognized', 'used_with_help', 'used_independently', 'automatic'
                )),
                review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            INSERT INTO lexical_chunk_v14
                (id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                 common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                 source_writing_evaluation_id, source_reading_session_attempt_id, source_scenario_pack_id,
                 productive_status, review_item_id, last_used_at, created_at)
            SELECT
                id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                source_writing_evaluation_id, source_reading_session_attempt_id, NULL,
                productive_status, review_item_id, last_used_at, created_at
            FROM lexical_chunk;
            DROP TABLE lexical_chunk;
            ALTER TABLE lexical_chunk_v14 RENAME TO lexical_chunk;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_lexical_chunk_normalized_text ON lexical_chunk(normalized_text);
            CREATE INDEX IF NOT EXISTS idx_lexical_chunk_status ON lexical_chunk(productive_status);

            PRAGMA foreign_keys = ON;",
        )?;
    }

    if current_version < 15 {
        conn.execute_batch(
            "ALTER TABLE reading_session_attempt ADD COLUMN spoken_response_text TEXT;
            ALTER TABLE reading_session_attempt ADD COLUMN spoken_response_submitted_at INTEGER;",
        )?;
    }

    if current_version < 16 {
        conn.execute_batch(
            "CREATE TABLE dictionary_entry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_type TEXT NOT NULL CHECK (chunk_type IN (
                    'single_word', 'collocation', 'phrase', 'discourse_marker',
                    'hedging_expression', 'stance_phrase', 'register_specific_expression',
                    'domain_specific_expression'
                )),
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                examples_json TEXT NOT NULL,
                context_tag TEXT NOT NULL CHECK (context_tag IN ('reading', 'writing', 'conversation')),
                source_session_id INTEGER,
                excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1)),
                promoted_lexical_chunk_id INTEGER REFERENCES lexical_chunk(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL,
                last_looked_up_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_entry_normalized_text ON dictionary_entry(normalized_text);
            CREATE INDEX IF NOT EXISTS idx_dictionary_entry_excluded ON dictionary_entry(excluded, created_at);

            PRAGMA foreign_keys = OFF;

            CREATE TABLE lexical_chunk_v16 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_type TEXT NOT NULL CHECK (chunk_type IN (
                    'single_word', 'collocation', 'phrase', 'discourse_marker',
                    'hedging_expression', 'stance_phrase', 'register_specific_expression',
                    'domain_specific_expression'
                )),
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                register TEXT NOT NULL,
                target_level TEXT NOT NULL CHECK (target_level IN ('A1','A2','B1','B2','C1','C2')),
                domain TEXT,
                examples_json TEXT NOT NULL,
                common_error TEXT,
                origin TEXT NOT NULL CHECK (origin IN (
                    'correction', 'better_expression', 'repair_event', 'writing_task', 'reading_session',
                    'manual', 'scenario_pack', 'dictionary_lookup'
                )),
                source_correction_id INTEGER REFERENCES correction(id) ON DELETE SET NULL,
                source_expression_id INTEGER REFERENCES expression(id) ON DELETE SET NULL,
                source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                source_writing_evaluation_id INTEGER REFERENCES writing_evaluation(id) ON DELETE SET NULL,
                source_reading_session_attempt_id INTEGER REFERENCES reading_session_attempt(id) ON DELETE SET NULL,
                source_scenario_pack_id TEXT,
                source_dictionary_entry_id INTEGER REFERENCES dictionary_entry(id) ON DELETE SET NULL,
                productive_status TEXT NOT NULL DEFAULT 'not_tried' CHECK (productive_status IN (
                    'not_tried', 'recognized', 'used_with_help', 'used_independently', 'automatic'
                )),
                review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL
            );
            INSERT INTO lexical_chunk_v16
                (id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                 common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                 source_writing_evaluation_id, source_reading_session_attempt_id, source_scenario_pack_id,
                 source_dictionary_entry_id, productive_status, review_item_id, last_used_at, created_at)
            SELECT
                id, chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
                common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
                source_writing_evaluation_id, source_reading_session_attempt_id, source_scenario_pack_id,
                NULL, productive_status, review_item_id, last_used_at, created_at
            FROM lexical_chunk;
            DROP TABLE lexical_chunk;
            ALTER TABLE lexical_chunk_v16 RENAME TO lexical_chunk;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_lexical_chunk_normalized_text ON lexical_chunk(normalized_text);
            CREATE INDEX IF NOT EXISTS idx_lexical_chunk_status ON lexical_chunk(productive_status);

            PRAGMA foreign_keys = ON;",
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

    // Every command opens its own connection and calls `open_connection`, so
    // without this lock, concurrent commands at startup can race on a single
    // database file at once — both on the one-time WAL-mode conversion below
    // (which needs an exclusive lock and can otherwise surface as a spurious
    // "database is locked" before `busy_timeout` is even set on the losing
    // connection) and, worse, on `migrate`'s multi-statement DDL, where nothing
    // runs inside an explicit transaction, so two connections' statements can
    // interleave and corrupt the schema while still letting `user_version`
    // reach its final value. Serializing connection setup in-process closes
    // both windows; the lock is only ever held briefly once a database is
    // already up to date.
    let _migration_guard = migration_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    drop(_migration_guard);

    Ok(conn)
}

fn migration_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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
    origin: &str,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO turn (session_id, role, text, timestamp, origin) VALUES (?1, 'user', ?2, ?3, ?4)",
        params![session_id, transcript, now_ms, origin],
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
        let correction_id = tx.last_insert_rowid();

        // Only categories that name a reusable expression (not a one-off
        // grammar/cohesion slip) become chunk candidates — see the slice's
        // plan for why grammar/cohesion are excluded.
        if matches!(
            correction.category,
            CorrectionCategory::Vocabulary
                | CorrectionCategory::Naturalness
                | CorrectionCategory::Clarity
                | CorrectionCategory::Register
        ) {
            create_chunk_candidate(
                &tx,
                ChunkCandidateInput {
                    chunk_type: chunk::infer_chunk_type(&correction.correction),
                    text: &correction.correction,
                    meaning: &correction.explanation,
                    register: "neutral",
                    target_level: CefrLevel::C1,
                    domain: None,
                    examples: std::slice::from_ref(&correction.correction),
                    common_error: Some(&correction.original),
                    origin: ChunkOrigin::Correction,
                    source_correction_id: Some(correction_id),
                    source_expression_id: None,
                    source_repair_event_id: None,
                    source_writing_evaluation_id: None,
                    source_reading_session_attempt_id: None,
                    source_scenario_pack_id: None,
                    source_dictionary_entry_id: None,
                },
                now_ms,
            )?;
        }
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
        let expression_id = tx.last_insert_rowid();

        let meaning = expression
            .explanation
            .clone()
            .unwrap_or_else(|| "A more natural way to say this.".to_string());
        create_chunk_candidate(
            &tx,
            ChunkCandidateInput {
                chunk_type: chunk::infer_chunk_type(&expression.suggestion),
                text: &expression.suggestion,
                meaning: &meaning,
                register: "neutral",
                target_level: CefrLevel::C1,
                domain: None,
                examples: std::slice::from_ref(&expression.suggestion),
                common_error: expression.original.as_deref(),
                origin: ChunkOrigin::BetterExpression,
                source_correction_id: None,
                source_expression_id: Some(expression_id),
                source_repair_event_id: None,
                source_writing_evaluation_id: None,
                source_reading_session_attempt_id: None,
                source_scenario_pack_id: None,
                source_dictionary_entry_id: None,
            },
            now_ms,
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
    source_writing_task_id: Option<i64>,
    source_chunk_id: Option<i64>,
    source_reading_session_attempt_id: Option<i64>,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO review_item
            (type, content, source, source_repair_event_id, source_session_id, source_assessment_id,
             source_pronunciation_target_id, source_writing_task_id, source_chunk_id,
             source_reading_session_attempt_id, stage, next_review_at,
             last_reviewed_at, review_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, NULL, 0, ?11)",
        params![
            review_item_type_str(item_type),
            content,
            review_source_str(source),
            source_repair_event_id,
            source_session_id,
            source_assessment_id,
            source_pronunciation_target_id,
            source_writing_task_id,
            source_chunk_id,
            source_reading_session_attempt_id,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

// ---------------------------------------------------------------------
// Lexical chunk persistence (productive vocabulary chunk bank)
// ---------------------------------------------------------------------

fn lexical_chunk_type_str(chunk_type: LexicalChunkType) -> &'static str {
    match chunk_type {
        LexicalChunkType::SingleWord => "single_word",
        LexicalChunkType::Collocation => "collocation",
        LexicalChunkType::Phrase => "phrase",
        LexicalChunkType::DiscourseMarker => "discourse_marker",
        LexicalChunkType::HedgingExpression => "hedging_expression",
        LexicalChunkType::StancePhrase => "stance_phrase",
        LexicalChunkType::RegisterSpecificExpression => "register_specific_expression",
        LexicalChunkType::DomainSpecificExpression => "domain_specific_expression",
    }
}

fn parse_lexical_chunk_type(value: &str) -> Result<LexicalChunkType, std::io::Error> {
    match value {
        "single_word" => Ok(LexicalChunkType::SingleWord),
        "collocation" => Ok(LexicalChunkType::Collocation),
        "phrase" => Ok(LexicalChunkType::Phrase),
        "discourse_marker" => Ok(LexicalChunkType::DiscourseMarker),
        "hedging_expression" => Ok(LexicalChunkType::HedgingExpression),
        "stance_phrase" => Ok(LexicalChunkType::StancePhrase),
        "register_specific_expression" => Ok(LexicalChunkType::RegisterSpecificExpression),
        "domain_specific_expression" => Ok(LexicalChunkType::DomainSpecificExpression),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown lexical chunk type: {other}"),
        )),
    }
}

fn chunk_origin_str(origin: ChunkOrigin) -> &'static str {
    match origin {
        ChunkOrigin::Correction => "correction",
        ChunkOrigin::BetterExpression => "better_expression",
        ChunkOrigin::RepairEvent => "repair_event",
        ChunkOrigin::WritingTask => "writing_task",
        ChunkOrigin::ReadingSession => "reading_session",
        ChunkOrigin::Manual => "manual",
        ChunkOrigin::ScenarioPack => "scenario_pack",
        ChunkOrigin::DictionaryLookup => "dictionary_lookup",
    }
}

fn parse_chunk_origin(value: &str) -> Result<ChunkOrigin, std::io::Error> {
    match value {
        "correction" => Ok(ChunkOrigin::Correction),
        "better_expression" => Ok(ChunkOrigin::BetterExpression),
        "repair_event" => Ok(ChunkOrigin::RepairEvent),
        "writing_task" => Ok(ChunkOrigin::WritingTask),
        "reading_session" => Ok(ChunkOrigin::ReadingSession),
        "manual" => Ok(ChunkOrigin::Manual),
        "scenario_pack" => Ok(ChunkOrigin::ScenarioPack),
        "dictionary_lookup" => Ok(ChunkOrigin::DictionaryLookup),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown chunk origin: {other}"),
        )),
    }
}

fn productive_status_str(status: ProductiveStatus) -> &'static str {
    match status {
        ProductiveStatus::NotTried => "not_tried",
        ProductiveStatus::Recognized => "recognized",
        ProductiveStatus::UsedWithHelp => "used_with_help",
        ProductiveStatus::UsedIndependently => "used_independently",
        ProductiveStatus::Automatic => "automatic",
    }
}

fn parse_productive_status(value: &str) -> Result<ProductiveStatus, std::io::Error> {
    match value {
        "not_tried" => Ok(ProductiveStatus::NotTried),
        "recognized" => Ok(ProductiveStatus::Recognized),
        "used_with_help" => Ok(ProductiveStatus::UsedWithHelp),
        "used_independently" => Ok(ProductiveStatus::UsedIndependently),
        "automatic" => Ok(ProductiveStatus::Automatic),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown productive status: {other}"),
        )),
    }
}

fn exercise_type_str(exercise_type: ExerciseType) -> &'static str {
    match exercise_type {
        ExerciseType::UseInSentence => "use_in_sentence",
        ExerciseType::CompleteResponse => "complete_response",
        ExerciseType::RewriteSentence => "rewrite_sentence",
        ExerciseType::SpokenResponse => "spoken_response",
        ExerciseType::MiniParagraph => "mini_paragraph",
    }
}

fn modality_str(modality: Modality) -> &'static str {
    match modality {
        Modality::Written => "written",
        Modality::Spoken => "spoken",
    }
}

const LEXICAL_CHUNK_COLUMNS: &str = "id, chunk_type, text, meaning, register, target_level, domain, \
     examples_json, common_error, origin, productive_status, review_item_id, last_used_at, created_at";

fn lexical_chunk_from_row(row: &rusqlite::Row) -> rusqlite::Result<chunk::LexicalChunk> {
    let chunk_type: String = row.get(1)?;
    let target_level: String = row.get(5)?;
    let examples_json: String = row.get(7)?;
    let origin: String = row.get(9)?;
    let productive_status: String = row.get(10)?;
    let review_item_id: Option<i64> = row.get(11)?;
    let examples: Vec<String> = serde_json::from_str(&examples_json).unwrap_or_default();
    Ok(chunk::LexicalChunk {
        id: row.get(0)?,
        chunk_type: parse_lexical_chunk_type(&chunk_type).map_err(|error| column_conversion_error(1, error))?,
        text: row.get(2)?,
        meaning: row.get(3)?,
        register: row.get(4)?,
        target_level: parse_cefr_level(&target_level).map_err(|error| column_conversion_error(5, error))?,
        domain: row.get(6)?,
        examples,
        common_error: row.get(8)?,
        origin: parse_chunk_origin(&origin).map_err(|error| column_conversion_error(9, error))?,
        productive_status: parse_productive_status(&productive_status)
            .map_err(|error| column_conversion_error(10, error))?,
        is_promoted: review_item_id.is_some(),
        last_used_at: row.get(12)?,
        created_at: row.get(13)?,
    })
}

pub(crate) fn lexical_chunk_by_id(
    conn: &Connection,
    chunk_id: i64,
) -> rusqlite::Result<Option<chunk::LexicalChunk>> {
    conn.query_row(
        &format!("SELECT {LEXICAL_CHUNK_COLUMNS} FROM lexical_chunk WHERE id = ?1"),
        params![chunk_id],
        lexical_chunk_from_row,
    )
    .optional()
}

pub(crate) fn find_chunk_by_normalized_text(
    conn: &Connection,
    normalized_text: &str,
) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM lexical_chunk WHERE normalized_text = ?1",
        params![normalized_text],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn list_active_lexical_chunks(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<chunk::LexicalChunk>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {LEXICAL_CHUNK_COLUMNS} FROM lexical_chunk ORDER BY created_at DESC LIMIT ?1"
    ))?;
    let rows = statement.query_map(params![limit], lexical_chunk_from_row)?;
    rows.collect()
}

/// The single entry point every chunk source (corrections, better
/// expressions, repair events, writing feedback, manual add) goes through.
/// Normalizes the text and checks `normalized_text` for a dedup match
/// first — `(existing_id, false)` if one exists, `(new_id, true)` if a row
/// was actually inserted. Callers that only care about "the chunk exists"
/// (persist_turn, writing.rs, manual add) can ignore the bool; repair.rs
/// uses it to decide whether to auto-promote.
pub(crate) fn create_chunk_candidate(
    conn: &Connection,
    input: ChunkCandidateInput,
    now_ms: i64,
) -> rusqlite::Result<(i64, bool)> {
    let normalized_text = chunk::normalize_chunk_text(input.text);
    if let Some(existing_id) = find_chunk_by_normalized_text(conn, &normalized_text)? {
        return Ok((existing_id, false));
    }

    let examples_json = serde_json::to_string(input.examples).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO lexical_chunk
            (chunk_type, text, normalized_text, meaning, register, target_level, domain, examples_json,
             common_error, origin, source_correction_id, source_expression_id, source_repair_event_id,
             source_writing_evaluation_id, source_reading_session_attempt_id, source_scenario_pack_id,
             source_dictionary_entry_id, productive_status, review_item_id, last_used_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'not_tried', NULL, NULL, ?18)",
        params![
            lexical_chunk_type_str(input.chunk_type),
            input.text,
            normalized_text,
            input.meaning,
            input.register,
            cefr_level_str(input.target_level),
            input.domain,
            examples_json,
            input.common_error,
            chunk_origin_str(input.origin),
            input.source_correction_id,
            input.source_expression_id,
            input.source_repair_event_id,
            input.source_writing_evaluation_id,
            input.source_reading_session_attempt_id,
            input.source_scenario_pack_id,
            input.source_dictionary_entry_id,
            now_ms,
        ],
    )?;
    Ok((conn.last_insert_rowid(), true))
}

/// Promotes a chunk into `ReviewItem` — the architectural boundary the
/// slice's docs are explicit about (`LexicalChunk` feeds `ReviewItem`, it
/// doesn't replace it). Errors if the chunk is already promoted, mirroring
/// the guard `submit_pronunciation_attempt` uses before promoting a target.
pub(crate) fn promote_chunk_to_review(
    conn: &Connection,
    chunk_id: i64,
    now_ms: i64,
) -> Result<chunk::LexicalChunk, HistoryCommandError> {
    let existing = lexical_chunk_by_id(conn, chunk_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "not-found",
            "That chunk no longer exists.",
            format!("lexical_chunk {chunk_id} not found"),
        )
    })?;
    if existing.is_promoted {
        return Err(HistoryCommandError::new(
            "already-promoted",
            "This chunk is already in spaced review.",
            format!("lexical_chunk {chunk_id} already promoted"),
        ));
    }

    let item_type = chunk::chunk_review_item_type(existing.chunk_type);
    let content = format!("{} — {}", existing.text, existing.meaning);
    let review_item_id = insert_review_item(
        conn,
        item_type,
        &content,
        ReviewSource::Chunk,
        None,
        None,
        None,
        None,
        None,
        Some(chunk_id),
        None,
        now_ms,
    )?;
    conn.execute(
        "UPDATE lexical_chunk SET review_item_id = ?1 WHERE id = ?2",
        params![review_item_id, chunk_id],
    )?;

    lexical_chunk_by_id(conn, chunk_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "chunk-task-failed",
            "The chunk could not be promoted to spaced review.",
            format!("lexical_chunk {chunk_id} vanished after promotion"),
        )
    })
}

/// Persists a practice attempt and applies `chunk::apply_chunk_outcome` to
/// the chunk's `productive_status`, bumping `last_used_at`. This is the
/// direct-practice counterpart to `apply_outcome_to_source_chunk`, which
/// applies the same rule when a *promoted* chunk's review item outcome is
/// recorded from a live conversation instead.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_lexical_chunk_attempt(
    conn: &Connection,
    chunk_id: i64,
    exercise_type: ExerciseType,
    modality: Modality,
    prompt: &str,
    transcript: &str,
    outcome: ReviewOutcome,
    now_ms: i64,
) -> Result<chunk::LexicalChunk, HistoryCommandError> {
    conn.execute(
        "INSERT INTO lexical_chunk_attempt
            (lexical_chunk_id, exercise_type, modality, prompt, transcript, outcome, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            chunk_id,
            exercise_type_str(exercise_type),
            modality_str(modality),
            prompt,
            transcript,
            review_outcome_str(outcome),
            now_ms,
        ],
    )?;

    apply_outcome_to_chunk(conn, chunk_id, outcome, now_ms)?;

    lexical_chunk_by_id(conn, chunk_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "chunk-task-failed",
            "The practice attempt could not be saved.",
            format!("lexical_chunk {chunk_id} vanished after attempt"),
        )
    })
}

pub(crate) fn recent_lexical_chunk_attempts(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<chunk::LexicalChunkAttemptSummary>> {
    let mut statement = conn.prepare(
        "SELECT a.id, a.lexical_chunk_id, c.text, a.outcome, a.created_at
         FROM lexical_chunk_attempt a
         JOIN lexical_chunk c ON c.id = a.lexical_chunk_id
         ORDER BY a.created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    rows.map(|row| {
        let (id, chunk_id, chunk_text, outcome, created_at) = row?;
        Ok(chunk::LexicalChunkAttemptSummary {
            id,
            chunk_id,
            chunk_text,
            outcome: parse_review_outcome(&outcome).map_err(|error| column_conversion_error(3, error))?,
            created_at,
        })
    })
    .collect()
}

fn apply_outcome_to_chunk(
    conn: &Connection,
    chunk_id: i64,
    outcome: ReviewOutcome,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let current_status: String = conn.query_row(
        "SELECT productive_status FROM lexical_chunk WHERE id = ?1",
        params![chunk_id],
        |row| row.get(0),
    )?;
    let new_status = chunk::apply_chunk_outcome(
        parse_productive_status(&current_status).map_err(|error| column_conversion_error(0, error))?,
        outcome,
    );
    conn.execute(
        "UPDATE lexical_chunk SET productive_status = ?1, last_used_at = ?2 WHERE id = ?3",
        params![productive_status_str(new_status), now_ms, chunk_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------
// dictionary_entry — the select-to-explain personal dictionary. Kept
// standalone from lexical_chunk (see chunk::ChunkOrigin::DictionaryLookup
// doc comment for why): a lookup only needs word/meaning/examples, not the
// register/target_level/domain the practice pipeline requires. A lookup
// can be one-way "promoted" into lexical_chunk via
// `promote_dictionary_entry_to_chunk` when the learner wants to drill it.
// ---------------------------------------------------------------------

fn dictionary_context_tag_str(tag: DictionaryContextTag) -> &'static str {
    match tag {
        DictionaryContextTag::Reading => "reading",
        DictionaryContextTag::Writing => "writing",
        DictionaryContextTag::Conversation => "conversation",
    }
}

fn parse_dictionary_context_tag(value: &str) -> Result<DictionaryContextTag, std::io::Error> {
    match value {
        "reading" => Ok(DictionaryContextTag::Reading),
        "writing" => Ok(DictionaryContextTag::Writing),
        "conversation" => Ok(DictionaryContextTag::Conversation),
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown dictionary context tag: {other}"),
        )),
    }
}

const DICTIONARY_ENTRY_COLUMNS: &str = "id, chunk_type, text, meaning, examples_json, context_tag, \
     source_session_id, excluded, promoted_lexical_chunk_id, created_at, last_looked_up_at";

fn dictionary_entry_from_row(row: &rusqlite::Row) -> rusqlite::Result<dictionary::DictionaryEntry> {
    let chunk_type: String = row.get(1)?;
    let examples_json: String = row.get(4)?;
    let context_tag: String = row.get(5)?;
    let excluded: i64 = row.get(7)?;
    let examples: Vec<String> = serde_json::from_str(&examples_json).unwrap_or_default();
    Ok(dictionary::DictionaryEntry {
        id: row.get(0)?,
        chunk_type: parse_lexical_chunk_type(&chunk_type).map_err(|error| column_conversion_error(1, error))?,
        text: row.get(2)?,
        meaning: row.get(3)?,
        examples,
        context_tag: parse_dictionary_context_tag(&context_tag)
            .map_err(|error| column_conversion_error(5, error))?,
        source_session_id: row.get(6)?,
        excluded: excluded != 0,
        promoted_lexical_chunk_id: row.get(8)?,
        created_at: row.get(9)?,
        last_looked_up_at: row.get(10)?,
    })
}

pub(crate) fn dictionary_entry_by_id(
    conn: &Connection,
    entry_id: i64,
) -> rusqlite::Result<Option<dictionary::DictionaryEntry>> {
    conn.query_row(
        &format!("SELECT {DICTIONARY_ENTRY_COLUMNS} FROM dictionary_entry WHERE id = ?1"),
        params![entry_id],
        dictionary_entry_from_row,
    )
    .optional()
}

fn find_dictionary_entry_by_normalized_text(
    conn: &Connection,
    normalized_text: &str,
) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM dictionary_entry WHERE normalized_text = ?1",
        params![normalized_text],
        |row| row.get(0),
    )
    .optional()
}

/// Every successful lookup auto-saves (per spec — no separate "save"
/// step). Repeated lookups of the same word refresh the stored
/// explanation/context/timestamp in place rather than accumulating
/// duplicate rows, mirroring `create_chunk_candidate`'s dedup-by-
/// `normalized_text` approach.
#[allow(clippy::too_many_arguments)]
pub(crate) fn upsert_dictionary_entry(
    conn: &Connection,
    chunk_type: LexicalChunkType,
    text: &str,
    meaning: &str,
    examples: &[String],
    context_tag: DictionaryContextTag,
    source_session_id: Option<i64>,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let normalized_text = chunk::normalize_chunk_text(text);
    let examples_json = serde_json::to_string(examples).unwrap_or_else(|_| "[]".to_string());

    if let Some(existing_id) = find_dictionary_entry_by_normalized_text(conn, &normalized_text)? {
        conn.execute(
            "UPDATE dictionary_entry
             SET chunk_type = ?1, meaning = ?2, examples_json = ?3, context_tag = ?4,
                 source_session_id = ?5, last_looked_up_at = ?6
             WHERE id = ?7",
            params![
                lexical_chunk_type_str(chunk_type),
                meaning,
                examples_json,
                dictionary_context_tag_str(context_tag),
                source_session_id,
                now_ms,
                existing_id,
            ],
        )?;
        return Ok(existing_id);
    }

    conn.execute(
        "INSERT INTO dictionary_entry
            (chunk_type, text, normalized_text, meaning, examples_json, context_tag, source_session_id,
             excluded, created_at, last_looked_up_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
        params![
            lexical_chunk_type_str(chunk_type),
            text,
            normalized_text,
            meaning,
            examples_json,
            dictionary_context_tag_str(context_tag),
            source_session_id,
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn list_dictionary_entries(
    conn: &Connection,
    context_tag: Option<DictionaryContextTag>,
    include_excluded: bool,
    limit: i64,
) -> rusqlite::Result<Vec<dictionary::DictionaryEntry>> {
    let context_tag_str = context_tag.map(dictionary_context_tag_str);
    let mut statement = conn.prepare(&format!(
        "SELECT {DICTIONARY_ENTRY_COLUMNS} FROM dictionary_entry \
         WHERE (?1 IS NULL OR context_tag = ?1) AND (?2 = 1 OR excluded = 0) \
         ORDER BY created_at DESC LIMIT ?3"
    ))?;
    let rows = statement.query_map(
        params![context_tag_str, include_excluded as i64, limit],
        dictionary_entry_from_row,
    )?;
    rows.collect()
}

pub(crate) fn set_dictionary_entry_excluded(
    conn: &Connection,
    entry_id: i64,
    excluded: bool,
) -> Result<dictionary::DictionaryEntry, HistoryCommandError> {
    conn.execute(
        "UPDATE dictionary_entry SET excluded = ?1 WHERE id = ?2",
        params![excluded as i64, entry_id],
    )?;
    dictionary_entry_by_id(conn, entry_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "not-found",
            "That dictionary entry no longer exists.",
            format!("dictionary_entry {entry_id} not found"),
        )
    })
}

/// Bridges a dictionary lookup into the existing practice/SRS pipeline —
/// one-way and optional. Defaults `register`/`target_level`/`domain`
/// since a quick lookup doesn't naturally produce them (unlike
/// corrections/writing feedback, which do); the learner can still refine
/// a promoted chunk from the Chunk Bank like any manually-added one.
/// Idempotent: re-promoting an already-promoted entry just returns the
/// existing linked chunk instead of erroring or duplicating.
pub(crate) fn promote_dictionary_entry_to_chunk(
    conn: &Connection,
    entry_id: i64,
    now_ms: i64,
) -> Result<chunk::LexicalChunk, HistoryCommandError> {
    let entry = dictionary_entry_by_id(conn, entry_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "not-found",
            "That dictionary entry no longer exists.",
            format!("dictionary_entry {entry_id} not found"),
        )
    })?;
    if let Some(chunk_id) = entry.promoted_lexical_chunk_id {
        return lexical_chunk_by_id(conn, chunk_id)?.ok_or_else(|| {
            HistoryCommandError::new(
                "chunk-task-failed",
                "The promoted chunk could not be found.",
                format!("lexical_chunk {chunk_id} vanished after promotion"),
            )
        });
    }

    const DEFAULT_REGISTER: &str = "neutral";
    const DEFAULT_TARGET_LEVEL: CefrLevel = CefrLevel::B2;

    let (chunk_id, _created) = create_chunk_candidate(
        conn,
        ChunkCandidateInput {
            chunk_type: entry.chunk_type,
            text: &entry.text,
            meaning: &entry.meaning,
            register: DEFAULT_REGISTER,
            target_level: DEFAULT_TARGET_LEVEL,
            domain: None,
            examples: &entry.examples,
            common_error: None,
            origin: ChunkOrigin::DictionaryLookup,
            source_correction_id: None,
            source_expression_id: None,
            source_repair_event_id: None,
            source_writing_evaluation_id: None,
            source_reading_session_attempt_id: None,
            source_scenario_pack_id: None,
            source_dictionary_entry_id: Some(entry_id),
        },
        now_ms,
    )?;
    conn.execute(
        "UPDATE dictionary_entry SET promoted_lexical_chunk_id = ?1 WHERE id = ?2",
        params![chunk_id, entry_id],
    )?;
    lexical_chunk_by_id(conn, chunk_id)?.ok_or_else(|| {
        HistoryCommandError::new(
            "chunk-task-failed",
            "The word could not be promoted to practice.",
            format!("lexical_chunk {chunk_id} vanished after promotion"),
        )
    })
}

/// Called from `record_review_event_and_reschedule` right after a review
/// item's outcome is recorded: if the item was sourced from a chunk
/// (`source = Chunk`), cascades the same outcome onto the chunk's
/// `productive_status`. This is what makes a promoted chunk's status
/// advance "for free" when the tutor surfaces it in a live conversation —
/// no conversation-side code needs to know chunks exist.
fn apply_outcome_to_source_chunk(
    conn: &Connection,
    review_item_id: i64,
    outcome: ReviewOutcome,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let source_chunk_id: Option<i64> = conn
        .query_row(
            "SELECT source_chunk_id FROM review_item WHERE id = ?1 AND source = 'chunk'",
            params![review_item_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    if let Some(chunk_id) = source_chunk_id {
        apply_outcome_to_chunk(conn, chunk_id, outcome, now_ms)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Writing task persistence (writing gym)
// ---------------------------------------------------------------------

pub(crate) fn insert_writing_task(
    conn: &Connection,
    task_type: WritingTaskType,
    target_level: CefrLevel,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO writing_task (task_type, target_level, status, created_at)
         VALUES (?1, ?2, 'drafting', ?3)",
        params![
            writing_task_type_str(task_type),
            cefr_level_str(target_level),
            now_ms,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

fn insert_writing_evaluation_tx(
    tx: &rusqlite::Transaction,
    writing_task_id: i64,
    stage: WritingEvaluationStage,
    record: &WritingEvaluationRecord,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    tx.execute(
        "INSERT INTO writing_evaluation (writing_task_id, stage, overall_level, rewrite_instruction, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            writing_task_id,
            writing_evaluation_stage_str(stage),
            cefr_level_str(record.overall_level),
            &record.rewrite_instruction,
            now_ms,
        ],
    )?;
    let evaluation_id = tx.last_insert_rowid();

    for dimension in &record.dimensions {
        tx.execute(
            "INSERT INTO writing_dimension_score (writing_evaluation_id, dimension, level, evidence)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                evaluation_id,
                writing_dimension_str(dimension.dimension),
                cefr_level_str(dimension.level),
                &dimension.evidence,
            ],
        )?;
    }
    for (position, issue) in record.priority_issues.iter().enumerate() {
        tx.execute(
            "INSERT INTO writing_priority_issue
                (writing_evaluation_id, category, original, suggested, explanation, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                evaluation_id,
                writing_dimension_str(issue.category),
                &issue.original,
                &issue.suggested,
                &issue.explanation,
                position as i64,
            ],
        )?;
    }
    let task_type_domain: Option<String> = tx
        .query_row(
            "SELECT task_type FROM writing_task WHERE id = ?1",
            params![writing_task_id],
            |row| row.get(0),
        )
        .optional()?;

    for (position, useful_chunk) in record.useful_chunks.iter().enumerate() {
        tx.execute(
            "INSERT INTO writing_useful_chunk (writing_evaluation_id, chunk, register, example, position)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                evaluation_id,
                &useful_chunk.chunk,
                &useful_chunk.register,
                &useful_chunk.example,
                position as i64,
            ],
        )?;

        create_chunk_candidate(
            tx,
            ChunkCandidateInput {
                chunk_type: chunk::infer_chunk_type(&useful_chunk.chunk),
                text: &useful_chunk.chunk,
                meaning: &useful_chunk.example,
                register: &useful_chunk.register,
                target_level: record.overall_level,
                domain: task_type_domain.as_deref(),
                examples: std::slice::from_ref(&useful_chunk.example),
                common_error: None,
                origin: ChunkOrigin::WritingTask,
                source_correction_id: None,
                source_expression_id: None,
                source_repair_event_id: None,
                source_writing_evaluation_id: Some(evaluation_id),
                source_reading_session_attempt_id: None,
                source_scenario_pack_id: None,
                source_dictionary_entry_id: None,
            },
            now_ms,
        )?;
    }

    Ok(evaluation_id)
}

pub(crate) fn record_writing_draft_evaluation(
    conn: &mut Connection,
    writing_task_id: i64,
    draft_text: &str,
    record: &WritingEvaluationRecord,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE writing_task SET draft_text = ?1, draft_submitted_at = ?2, status = 'draft_evaluated' WHERE id = ?3",
        params![draft_text, now_ms, writing_task_id],
    )?;
    let evaluation_id =
        insert_writing_evaluation_tx(&tx, writing_task_id, WritingEvaluationStage::Draft, record, now_ms)?;
    tx.commit()?;
    Ok(evaluation_id)
}

pub(crate) fn record_writing_rewrite_evaluation(
    conn: &mut Connection,
    writing_task_id: i64,
    rewrite_text: &str,
    record: &WritingEvaluationRecord,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE writing_task SET rewrite_text = ?1, rewrite_submitted_at = ?2, status = 'rewrite_evaluated' WHERE id = ?3",
        params![rewrite_text, now_ms, writing_task_id],
    )?;
    let evaluation_id =
        insert_writing_evaluation_tx(&tx, writing_task_id, WritingEvaluationStage::Rewrite, record, now_ms)?;
    tx.commit()?;
    Ok(evaluation_id)
}

pub(crate) fn writing_evaluation_by_stage(
    conn: &Connection,
    writing_task_id: i64,
    stage: WritingEvaluationStage,
) -> rusqlite::Result<Option<(i64, WritingEvaluationRecord)>> {
    let found = conn
        .query_row(
            "SELECT id, overall_level, rewrite_instruction FROM writing_evaluation
             WHERE writing_task_id = ?1 AND stage = ?2",
            params![writing_task_id, writing_evaluation_stage_str(stage)],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;

    let Some((evaluation_id, overall_level_raw, rewrite_instruction)) = found else {
        return Ok(None);
    };
    let overall_level =
        parse_cefr_level(&overall_level_raw).map_err(|error| column_conversion_error(1, error))?;

    let mut dimension_statement = conn.prepare(
        "SELECT dimension, level, evidence FROM writing_dimension_score WHERE writing_evaluation_id = ?1",
    )?;
    let dimensions = dimension_statement
        .query_map(params![evaluation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .map(|row| {
            let (dimension, level, evidence) = row?;
            Ok(writing::DimensionScoreRecord {
                dimension: parse_writing_dimension(&dimension)
                    .map_err(|error| column_conversion_error(0, error))?,
                level: parse_cefr_level(&level).map_err(|error| column_conversion_error(1, error))?,
                evidence,
            })
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut issue_statement = conn.prepare(
        "SELECT category, original, suggested, explanation FROM writing_priority_issue
         WHERE writing_evaluation_id = ?1 ORDER BY position ASC",
    )?;
    let priority_issues = issue_statement
        .query_map(params![evaluation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .map(|row| {
            let (category, original, suggested, explanation) = row?;
            Ok(writing::PriorityIssueRecord {
                category: parse_writing_dimension(&category)
                    .map_err(|error| column_conversion_error(0, error))?,
                original,
                suggested,
                explanation,
            })
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut chunk_statement = conn.prepare(
        "SELECT chunk, register, example FROM writing_useful_chunk
         WHERE writing_evaluation_id = ?1 ORDER BY position ASC",
    )?;
    let useful_chunks = chunk_statement
        .query_map(params![evaluation_id], |row| {
            Ok(writing::UsefulChunkRecord {
                chunk: row.get(0)?,
                register: row.get(1)?,
                example: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Some((
        evaluation_id,
        WritingEvaluationRecord {
            overall_level,
            rewrite_instruction,
            dimensions,
            priority_issues,
            useful_chunks,
        },
    )))
}

fn writing_evaluation_overall_level(
    conn: &Connection,
    writing_task_id: i64,
    stage: WritingEvaluationStage,
) -> rusqlite::Result<Option<CefrLevel>> {
    conn.query_row(
        "SELECT overall_level FROM writing_evaluation WHERE writing_task_id = ?1 AND stage = ?2",
        params![writing_task_id, writing_evaluation_stage_str(stage)],
        |row| row.get::<_, String>(0),
    )
    .optional()?
    .map(|value| parse_cefr_level(&value).map_err(|error| column_conversion_error(0, error)))
    .transpose()
}

pub(crate) fn writing_task_detail(
    conn: &Connection,
    writing_task_id: i64,
) -> rusqlite::Result<Option<writing::WritingTaskDetail>> {
    let core = conn
        .query_row(
            "SELECT task_type, target_level, status, draft_text, rewrite_text, created_at
             FROM writing_task WHERE id = ?1",
            params![writing_task_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;

    let Some((task_type, target_level, status, draft_text, rewrite_text, created_at)) = core else {
        return Ok(None);
    };

    let draft_evaluation = writing_evaluation_by_stage(conn, writing_task_id, WritingEvaluationStage::Draft)?
        .map(|(id, record)| writing::evaluation_result_from_record(id, WritingEvaluationStage::Draft, record, None));
    let rewrite_evaluation = writing_evaluation_by_stage(conn, writing_task_id, WritingEvaluationStage::Rewrite)?
        .map(|(id, record)| {
            writing::evaluation_result_from_record(id, WritingEvaluationStage::Rewrite, record, None)
        });

    Ok(Some(writing::WritingTaskDetail {
        id: writing_task_id,
        task_type: parse_writing_task_type(&task_type).map_err(|error| column_conversion_error(0, error))?,
        target_level: parse_cefr_level(&target_level).map_err(|error| column_conversion_error(1, error))?,
        status: parse_writing_task_status(&status).map_err(|error| column_conversion_error(2, error))?,
        draft_text,
        rewrite_text,
        created_at,
        draft_evaluation,
        rewrite_evaluation,
    }))
}

pub(crate) fn recent_writing_tasks(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<writing::WritingTaskSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, task_type, status, created_at FROM writing_task ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;

    rows.map(|row| {
        let (id, task_type, status, created_at) = row?;
        let draft_overall_level = writing_evaluation_overall_level(conn, id, WritingEvaluationStage::Draft)?;
        let rewrite_overall_level = writing_evaluation_overall_level(conn, id, WritingEvaluationStage::Rewrite)?;
        Ok(writing::WritingTaskSummary {
            id,
            task_type: parse_writing_task_type(&task_type).map_err(|error| column_conversion_error(1, error))?,
            status: parse_writing_task_status(&status).map_err(|error| column_conversion_error(2, error))?,
            draft_overall_level,
            rewrite_overall_level,
            created_at,
        })
    })
    .collect()
}

/// Whether the writing task's most recent evaluation (whichever stage ran
/// last) still has priority issues attached — used as the journey feed's
/// "needs review" signal for writing checkpoints.
pub(crate) fn writing_task_has_open_priority_issues(
    conn: &Connection,
    writing_task_id: i64,
) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM writing_priority_issue
         WHERE writing_evaluation_id = (
             SELECT id FROM writing_evaluation
             WHERE writing_task_id = ?1
             ORDER BY created_at DESC LIMIT 1
         )",
        params![writing_task_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// ---------------------------------------------------------------------
// Reading session persistence (reading to writing)
// ---------------------------------------------------------------------

pub(crate) fn insert_reading_session_attempt(
    conn: &Connection,
    text_id: &str,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO reading_session_attempt (text_id, status, created_at)
         VALUES (?1, 'reading', ?2)",
        params![text_id, now_ms],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn record_reading_comprehension_answer(
    conn: &Connection,
    attempt_id: i64,
    is_correct: bool,
    now_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE reading_session_attempt
         SET comprehension_correct = ?1, comprehension_answered_at = ?2, status = 'comprehension_answered'
         WHERE id = ?3",
        params![is_correct as i64, now_ms, attempt_id],
    )?;
    Ok(())
}

pub(crate) fn record_reading_selected_chunks(
    conn: &Connection,
    attempt_id: i64,
    chunk_ids: &[i64],
) -> rusqlite::Result<()> {
    let chunk_ids_json = serde_json::to_string(chunk_ids).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE reading_session_attempt
         SET selected_chunk_ids_json = ?1, status = 'chunks_selected'
         WHERE id = ?2",
        params![chunk_ids_json, attempt_id],
    )?;
    Ok(())
}

fn insert_reading_evaluation_tx(
    tx: &rusqlite::Transaction,
    attempt_id: i64,
    record: &reading::ReadingEvaluationRecord,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    tx.execute(
        "INSERT INTO reading_session_evaluation
            (reading_session_attempt_id, summary_fidelity, response_relevance, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            attempt_id,
            summary_fidelity_str(record.summary_fidelity),
            response_relevance_str(record.response_relevance),
            now_ms,
        ],
    )?;
    let evaluation_id = tx.last_insert_rowid();

    for (position, issue) in record.priority_issues.iter().enumerate() {
        tx.execute(
            "INSERT INTO reading_session_priority_issue
                (reading_session_evaluation_id, category, original, suggested, explanation, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                evaluation_id,
                reading_issue_category_str(issue.category),
                &issue.original,
                &issue.suggested,
                &issue.explanation,
                position as i64,
            ],
        )?;
    }
    for (position, useful_chunk) in record.useful_chunks.iter().enumerate() {
        tx.execute(
            "INSERT INTO reading_session_useful_chunk
                (reading_session_evaluation_id, chunk, register, example, position)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                evaluation_id,
                &useful_chunk.chunk,
                &useful_chunk.register,
                &useful_chunk.example,
                position as i64,
            ],
        )?;
    }

    Ok(evaluation_id)
}

pub(crate) fn record_reading_production_evaluation(
    conn: &mut Connection,
    attempt_id: i64,
    summary_text: &str,
    response_text: &str,
    record: &reading::ReadingEvaluationRecord,
    now_ms: i64,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE reading_session_attempt
         SET summary_text = ?1, response_text = ?2, production_submitted_at = ?3, status = 'evaluated'
         WHERE id = ?4",
        params![summary_text, response_text, now_ms, attempt_id],
    )?;
    let evaluation_id = insert_reading_evaluation_tx(&tx, attempt_id, record, now_ms)?;
    tx.commit()?;
    Ok(evaluation_id)
}

pub(crate) fn record_reading_spoken_response(
    conn: &Connection,
    attempt_id: i64,
    spoken_response_text: &str,
    now_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE reading_session_attempt
         SET spoken_response_text = ?1, spoken_response_submitted_at = ?2
         WHERE id = ?3",
        params![spoken_response_text, now_ms, attempt_id],
    )?;
    Ok(())
}

fn reading_evaluation_by_attempt(
    conn: &Connection,
    attempt_id: i64,
) -> rusqlite::Result<Option<(i64, reading::ReadingEvaluationRecord)>> {
    let found = conn
        .query_row(
            "SELECT id, summary_fidelity, response_relevance FROM reading_session_evaluation
             WHERE reading_session_attempt_id = ?1",
            params![attempt_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;

    let Some((evaluation_id, summary_fidelity_raw, response_relevance_raw)) = found else {
        return Ok(None);
    };
    let summary_fidelity = parse_summary_fidelity(&summary_fidelity_raw)
        .map_err(|error| column_conversion_error(1, error))?;
    let response_relevance = parse_response_relevance(&response_relevance_raw)
        .map_err(|error| column_conversion_error(2, error))?;

    let mut issue_statement = conn.prepare(
        "SELECT category, original, suggested, explanation FROM reading_session_priority_issue
         WHERE reading_session_evaluation_id = ?1 ORDER BY position ASC",
    )?;
    let priority_issues = issue_statement
        .query_map(params![evaluation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .map(|row| {
            let (category, original, suggested, explanation) = row?;
            Ok(reading::ReadingPriorityIssueRecord {
                category: parse_reading_issue_category(&category)
                    .map_err(|error| column_conversion_error(0, error))?,
                original,
                suggested,
                explanation,
            })
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut chunk_statement = conn.prepare(
        "SELECT chunk, register, example FROM reading_session_useful_chunk
         WHERE reading_session_evaluation_id = ?1 ORDER BY position ASC",
    )?;
    let useful_chunks = chunk_statement
        .query_map(params![evaluation_id], |row| {
            Ok(reading::ReadingUsefulChunkRecord {
                chunk: row.get(0)?,
                register: row.get(1)?,
                example: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Some((
        evaluation_id,
        reading::ReadingEvaluationRecord {
            summary_fidelity,
            response_relevance,
            priority_issues,
            useful_chunks,
        },
    )))
}

pub(crate) fn recent_reading_sessions(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<reading::ReadingSessionSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, text_id, status, created_at FROM reading_session_attempt
         ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;

    rows.map(|row| {
        let (id, text_id, status, created_at) = row?;
        let evaluation = reading_evaluation_by_attempt(conn, id)?;
        Ok(reading::ReadingSessionSummary {
            id,
            text_id,
            status: parse_reading_session_status(&status)
                .map_err(|error| column_conversion_error(2, error))?,
            created_at,
            summary_fidelity: evaluation.as_ref().map(|(_, record)| record.summary_fidelity),
            response_relevance: evaluation.as_ref().map(|(_, record)| record.response_relevance),
        })
    })
    .collect()
}

pub(crate) fn reading_session_detail(
    conn: &Connection,
    attempt_id: i64,
) -> rusqlite::Result<Option<reading::ReadingSessionDetail>> {
    let core = conn
        .query_row(
            "SELECT text_id, status, comprehension_correct, selected_chunk_ids_json, summary_text,
                    response_text, created_at, spoken_response_text, spoken_response_submitted_at
             FROM reading_session_attempt WHERE id = ?1",
            params![attempt_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                ))
            },
        )
        .optional()?;

    let Some((
        text_id,
        status,
        comprehension_correct,
        selected_chunk_ids_json,
        summary_text,
        response_text,
        created_at,
        spoken_response_text,
        spoken_response_submitted_at,
    )) = core
    else {
        return Ok(None);
    };

    let selected_chunk_ids: Vec<i64> = selected_chunk_ids_json
        .as_deref()
        .map(|json| serde_json::from_str(json).unwrap_or_default())
        .unwrap_or_default();

    let evaluation = reading_evaluation_by_attempt(conn, attempt_id)?
        .map(|(id, record)| reading::reading_evaluation_result_from_record(id, record));

    Ok(Some(reading::ReadingSessionDetail {
        id: attempt_id,
        text_id,
        status: parse_reading_session_status(&status).map_err(|error| column_conversion_error(1, error))?,
        comprehension_correct: comprehension_correct.map(|value| value != 0),
        selected_chunk_ids,
        summary_text,
        response_text,
        created_at,
        evaluation,
        spoken_response_text,
        spoken_response_submitted_at,
    }))
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

    apply_outcome_to_source_chunk(conn, review_item_id, outcome, now_ms)?;

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
    origin: String,
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
) -> rusqlite::Result<Vec<(i64, String, String, i64, String)>> {
    let mut statement = conn.prepare(
        "SELECT id, role, text, timestamp, origin FROM turn
         WHERE session_id = ?1 ORDER BY timestamp ASC, id ASC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    rows.collect()
}

/// Deliberately tighter than tutor.rs's MAX_HISTORY_MESSAGES (24): a resume
/// re-injects a short recap, not the full rolling window of an
/// already-flowing conversation. Pure and testable independent of the DB.
const RESUME_RECENT_MESSAGE_LIMIT: usize = 12; // last 6 turn pairs

fn recent_tutor_messages(
    turns: &[(i64, String, String, i64, String)],
    limit: usize,
) -> Vec<TutorMessage> {
    let start = turns.len().saturating_sub(limit);
    turns[start..]
        .iter()
        .filter_map(|(_, role, text, _, _)| {
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
        .map(|(turn_id, role, text, timestamp, origin)| SessionTurnDetail {
            id: turn_id,
            role,
            text,
            timestamp,
            origin,
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
    origin: &'static str,
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
            origin,
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
                    None,
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
    pub(crate) id: i64,
    pub(crate) started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) completed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) estimated_level: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) confidence: Option<f64>,
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

    /// Regression test for a real corruption: every command opens its own
    /// connection via `open_connection`, so concurrent commands at app
    /// startup used to race through `migrate`'s multi-statement DDL on
    /// separate connections at once. That left a database whose
    /// `user_version` claimed the final schema version while several tables
    /// (`lexical_chunk`, `reading_session_attempt`, ...) were never actually
    /// created. `open_connection`'s migration lock must prevent this.
    #[test]
    fn concurrent_open_connection_calls_on_a_fresh_database_do_not_corrupt_the_schema() {
        let (_directory, path) = scratch_db();

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let path = path.clone();
                std::thread::spawn(move || open_connection(&path).expect("connection must open"))
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread must not panic");
        }

        let conn = Connection::open(&path).expect("connection must open");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        for table in [
            "lexical_chunk",
            "lexical_chunk_attempt",
            "reading_session_attempt",
            "reading_session_evaluation",
            "reading_session_priority_issue",
            "reading_session_useful_chunk",
            "review_item",
            "writing_task",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| panic!("query for {table} must succeed"));
            assert_eq!(exists, 1, "table {table} must exist after concurrent migration");
        }
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
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
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
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
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
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
                );
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK (type IN (
                        'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                    )),
                    content TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary', 'assessment_priority')),
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    source_assessment_id INTEGER,
                    source_pronunciation_target_id INTEGER,
                    stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
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
    fn migration_from_version_8_adds_turn_origin_column_defaulting_existing_rows_to_spoken() {
        let (_directory, path) = scratch_db();

        let turn_id = {
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
                    summary_json TEXT,
                    continued_from_session_id INTEGER
                );
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
                );
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK (type IN (
                        'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                    )),
                    content TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary', 'assessment_priority')),
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    source_assessment_id INTEGER,
                    source_pronunciation_target_id INTEGER,
                    stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO session (started_at, ended_at) VALUES (1000, 2000);
                INSERT INTO turn (session_id, role, text, timestamp) VALUES (1, 'user', 'hello', 1500);",
            )
            .expect("v8 session/turn tables must create");
            let turn_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 8)
                .expect("version must set");
            turn_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let origin: String = conn
            .query_row(
                "SELECT origin FROM turn WHERE id = ?1",
                params![turn_id],
                |row| row.get(0),
            )
            .expect("pre-existing turn row must survive migration");
        assert_eq!(origin, "spoken");
    }

    #[test]
    fn migration_from_version_9_rebuilds_correction_table_with_cohesion_and_register_categories() {
        let (_directory, path) = scratch_db();

        let correction_id = {
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
                    summary_json TEXT,
                    continued_from_session_id INTEGER
                );
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    origin TEXT NOT NULL DEFAULT 'spoken' CHECK (origin IN ('spoken', 'typed'))
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
                );
                CREATE INDEX idx_correction_turn ON correction(turn_id);
                CREATE INDEX idx_correction_category ON correction(category);
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK (type IN (
                        'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                    )),
                    content TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary', 'assessment_priority')),
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    source_assessment_id INTEGER,
                    source_pronunciation_target_id INTEGER,
                    stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO session (started_at, ended_at) VALUES (1000, 2000);
                INSERT INTO turn (session_id, role, text, timestamp) VALUES (1, 'user', 'hello', 1500);
                INSERT INTO correction (turn_id, original, correction, explanation, category, severity)
                    VALUES (1, 'hi', 'hello', 'more natural greeting', 'grammar', 'minor');",
            )
            .expect("v9 session/turn/correction tables must create");
            let correction_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 9)
                .expect("version must set");
            correction_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let (original, category): (String, String) = conn
            .query_row(
                "SELECT original, category FROM correction WHERE id = ?1",
                params![correction_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("pre-existing correction row must survive migration");
        assert_eq!(original, "hi");
        assert_eq!(category, "grammar");

        conn.execute(
            "INSERT INTO correction (turn_id, original, correction, explanation, category, severity)
             VALUES (1, 'x', 'y', 'z', 'cohesion', 'minor')",
            [],
        )
        .expect("cohesion category must now be accepted");
        conn.execute(
            "INSERT INTO correction (turn_id, original, correction, explanation, category, severity)
             VALUES (1, 'x', 'y', 'z', 'register', 'minor')",
            [],
        )
        .expect("register category must now be accepted");
    }

    #[test]
    fn migration_from_version_10_adds_writing_tables_and_extends_review_item_source() {
        let (_directory, path) = scratch_db();

        let review_item_id = {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE session (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER NOT NULL
                );
                CREATE TABLE repair_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT
                );
                CREATE TABLE assessment (
                    id INTEGER PRIMARY KEY AUTOINCREMENT
                );
                CREATE TABLE pronunciation_target (
                    id INTEGER PRIMARY KEY AUTOINCREMENT
                );
                CREATE TABLE review_item (
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
                    created_at INTEGER NOT NULL,
                    source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL
                );
                CREATE TABLE review_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    review_item_id INTEGER NOT NULL REFERENCES review_item(id) ON DELETE CASCADE,
                    session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                    outcome TEXT NOT NULL CHECK (outcome IN ('remembered', 'partially_remembered', 'missed', 'skipped')),
                    previous_stage INTEGER NOT NULL,
                    new_stage INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO review_item
                    (type, content, source, stage, next_review_at, last_reviewed_at, review_count, created_at)
                VALUES
                    ('grammar_pattern', 'past tense forms', 'repair_event', 0, 1000, NULL, 0, 1000);",
            )
            .expect("v10 review_item tables must create");
            let review_item_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 10)
                .expect("version must set");
            review_item_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        for table in [
            "writing_task",
            "writing_evaluation",
            "writing_dimension_score",
            "writing_priority_issue",
            "writing_useful_chunk",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .expect("sqlite_master must query");
            assert_eq!(exists, 1, "table {table} must exist after migration");
        }

        let (content, source): (String, String) = conn
            .query_row(
                "SELECT content, source FROM review_item WHERE id = ?1",
                params![review_item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("pre-existing review_item row must survive migration");
        assert_eq!(content, "past tense forms");
        assert_eq!(source, "repair_event");

        let task_id = insert_writing_task(&conn, WritingTaskType::ProfessionalEmail, CefrLevel::B2, 2_000)
            .expect("writing task must insert");
        conn.execute(
            "INSERT INTO review_item
                (type, content, source, source_writing_task_id, stage, next_review_at, last_reviewed_at, review_count, created_at)
             VALUES ('vocabulary', 'extensive experience', 'writing_task', ?1, 0, 2000, NULL, 0, 2000)",
            params![task_id],
        )
        .expect("writing_task must now be accepted as a review_item source");
    }

    #[test]
    fn migration_from_version_11_adds_lexical_chunk_tables_and_review_item_chunk_source() {
        let (_directory, path) = scratch_db();

        let review_item_id = {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE repair_event (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE assessment (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE pronunciation_target (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE writing_task (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE writing_evaluation (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE turn (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE correction (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE expression (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK (type IN (
                        'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                    )),
                    content TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN (
                        'repair_event', 'session_summary', 'assessment_priority', 'writing_task'
                    )),
                    source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                    source_session_id INTEGER REFERENCES session(id) ON DELETE SET NULL,
                    source_assessment_id INTEGER REFERENCES assessment(id) ON DELETE SET NULL,
                    source_pronunciation_target_id INTEGER REFERENCES pronunciation_target(id) ON DELETE SET NULL,
                    source_writing_task_id INTEGER REFERENCES writing_task(id) ON DELETE SET NULL,
                    stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO review_item
                    (type, content, source, stage, next_review_at, last_reviewed_at, review_count, created_at)
                VALUES
                    ('vocabulary', 'a growing concern', 'writing_task', 0, 1000, NULL, 0, 1000);",
            )
            .expect("v11 tables must create");
            let review_item_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 11)
                .expect("version must set");
            review_item_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        for table in ["lexical_chunk", "lexical_chunk_attempt"] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .expect("sqlite_master must query");
            assert_eq!(exists, 1, "table {table} must exist after migration");
        }

        let (content, source): (String, String) = conn
            .query_row(
                "SELECT content, source FROM review_item WHERE id = ?1",
                params![review_item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("pre-existing review_item row must survive migration");
        assert_eq!(content, "a growing concern");
        assert_eq!(source, "writing_task");

        conn.execute(
            "INSERT INTO review_item
                (type, content, source, source_chunk_id, stage, next_review_at, last_reviewed_at, review_count, created_at)
             VALUES ('phrase', 'raise concerns about', 'chunk', NULL, 0, 2000, NULL, 0, 2000)",
            [],
        )
        .expect("'chunk' must now be accepted as a review_item source");
    }

    #[test]
    fn migration_from_version_13_adds_scenario_pack_source_to_lexical_chunk() {
        let (_directory, path) = scratch_db();

        {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE correction (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE expression (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE repair_event (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE writing_evaluation (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE reading_session_attempt (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE review_item (id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE lexical_chunk (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_type TEXT NOT NULL,
                    text TEXT NOT NULL,
                    normalized_text TEXT NOT NULL UNIQUE,
                    meaning TEXT NOT NULL,
                    register TEXT NOT NULL,
                    target_level TEXT NOT NULL,
                    domain TEXT,
                    examples_json TEXT NOT NULL,
                    common_error TEXT,
                    origin TEXT NOT NULL CHECK (origin IN (
                        'correction', 'better_expression', 'repair_event', 'writing_task', 'reading_session', 'manual'
                    )),
                    source_correction_id INTEGER REFERENCES correction(id) ON DELETE SET NULL,
                    source_expression_id INTEGER REFERENCES expression(id) ON DELETE SET NULL,
                    source_repair_event_id INTEGER REFERENCES repair_event(id) ON DELETE SET NULL,
                    source_writing_evaluation_id INTEGER REFERENCES writing_evaluation(id) ON DELETE SET NULL,
                    source_reading_session_attempt_id INTEGER REFERENCES reading_session_attempt(id) ON DELETE SET NULL,
                    productive_status TEXT NOT NULL DEFAULT 'not_tried',
                    review_item_id INTEGER REFERENCES review_item(id) ON DELETE SET NULL,
                    last_used_at INTEGER,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO lexical_chunk
                    (chunk_type, text, normalized_text, meaning, register, target_level, examples_json, origin, created_at)
                VALUES
                    ('phrase', 'give up', 'give up', 'to stop trying', 'neutral', 'B1', '[]', 'manual', 1000);",
            )
            .expect("v13 lexical_chunk table must create");
            conn.pragma_update(None, "user_version", 13)
                .expect("version must set");
        }

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let (text, source_scenario_pack_id): (String, Option<String>) = conn
            .query_row(
                "SELECT text, source_scenario_pack_id FROM lexical_chunk WHERE normalized_text = 'give up'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("pre-existing lexical_chunk row must survive migration");
        assert_eq!(text, "give up");
        assert_eq!(source_scenario_pack_id, None);

        conn.execute(
            "INSERT INTO lexical_chunk
                (chunk_type, text, normalized_text, meaning, register, target_level, examples_json, origin,
                 source_scenario_pack_id, created_at)
             VALUES ('phrase', 'flag a blocker', 'flag a blocker', 'raise a blocking issue', 'professional', 'B1',
                 '[]', 'scenario_pack', 'daily-standup', 2000)",
            [],
        )
        .expect("'scenario_pack' origin and source_scenario_pack_id must now be accepted");
    }

    fn sample_chunk_input(text: &'static str) -> ChunkCandidateInput<'static> {
        ChunkCandidateInput {
            chunk_type: chunk::infer_chunk_type(text),
            text,
            meaning: "a short definition",
            register: "neutral",
            target_level: CefrLevel::C1,
            domain: None,
            examples: &[],
            common_error: None,
            origin: ChunkOrigin::Manual,
            source_correction_id: None,
            source_expression_id: None,
            source_repair_event_id: None,
            source_writing_evaluation_id: None,
            source_reading_session_attempt_id: None,
            source_scenario_pack_id: None,
            source_dictionary_entry_id: None,
        }
    }

    #[test]
    fn create_chunk_candidate_is_idempotent_for_the_same_normalized_text() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let (first_id, first_created) =
            create_chunk_candidate(&conn, sample_chunk_input("  Raise Concerns About  "), 1_000)
                .expect("first candidate must insert");
        assert!(first_created);

        let (second_id, second_created) =
            create_chunk_candidate(&conn, sample_chunk_input("raise concerns about"), 2_000)
                .expect("dedup lookup must succeed");
        assert_eq!(second_id, first_id);
        assert!(!second_created);

        let all = list_active_lexical_chunks(&conn, 10).expect("chunks must list");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn promote_chunk_to_review_links_review_item_and_rejects_double_promotion() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let (chunk_id, _) = create_chunk_candidate(&conn, sample_chunk_input("a growing concern"), 1_000)
            .expect("chunk must insert");

        let promoted = promote_chunk_to_review(&conn, chunk_id, 1_500).expect("chunk must promote");
        assert!(promoted.is_promoted);

        let (source, source_chunk_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT source, source_chunk_id FROM review_item
                 WHERE id = (SELECT review_item_id FROM lexical_chunk WHERE id = ?1)",
                params![chunk_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("review_item must exist");
        assert_eq!(source, "chunk");
        assert_eq!(source_chunk_id, Some(chunk_id));

        let error =
            promote_chunk_to_review(&conn, chunk_id, 2_000).expect_err("second promotion must fail");
        assert_eq!(error.into_parts().0, "already-promoted");
    }

    #[test]
    fn upsert_dictionary_entry_dedups_by_normalized_text_and_refreshes_content() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let first_id = upsert_dictionary_entry(
            &conn,
            LexicalChunkType::Phrase,
            "  Table This  ",
            "an old meaning",
            &["Old example.".to_string()],
            DictionaryContextTag::Reading,
            Some(42),
            1_000,
        )
        .expect("first lookup must insert");

        let second_id = upsert_dictionary_entry(
            &conn,
            LexicalChunkType::Phrase,
            "table this",
            "to postpone something until later",
            &["Let's table this for now.".to_string()],
            DictionaryContextTag::Conversation,
            Some(99),
            2_000,
        )
        .expect("second lookup must dedup");
        assert_eq!(second_id, first_id);

        let entries = list_dictionary_entries(&conn, None, false, 10).expect("entries must list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].meaning, "to postpone something until later");
        assert_eq!(entries[0].context_tag, DictionaryContextTag::Conversation);
        assert_eq!(entries[0].last_looked_up_at, 2_000);
    }

    #[test]
    fn list_dictionary_entries_filters_by_context_tag_and_excluded() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        upsert_dictionary_entry(
            &conn,
            LexicalChunkType::SingleWord,
            "ubiquitous",
            "present everywhere",
            &["Smartphones are ubiquitous.".to_string()],
            DictionaryContextTag::Reading,
            None,
            1_000,
        )
        .expect("reading entry must insert");
        let writing_id = upsert_dictionary_entry(
            &conn,
            LexicalChunkType::SingleWord,
            "concise",
            "brief and clear",
            &["A concise summary.".to_string()],
            DictionaryContextTag::Writing,
            None,
            1_100,
        )
        .expect("writing entry must insert");

        assert_eq!(
            list_dictionary_entries(&conn, Some(DictionaryContextTag::Writing), false, 10)
                .expect("filtered list must query")
                .len(),
            1
        );
        assert_eq!(
            list_dictionary_entries(&conn, None, false, 10)
                .expect("unfiltered list must query")
                .len(),
            2
        );

        set_dictionary_entry_excluded(&conn, writing_id, true).expect("entry must exclude");
        assert_eq!(
            list_dictionary_entries(&conn, None, false, 10)
                .expect("list excluding hidden entries must query")
                .len(),
            1
        );
        assert_eq!(
            list_dictionary_entries(&conn, None, true, 10)
                .expect("list including hidden entries must query")
                .len(),
            2
        );
    }

    #[test]
    fn promote_dictionary_entry_to_chunk_is_idempotent_and_links_back() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let entry_id = upsert_dictionary_entry(
            &conn,
            LexicalChunkType::Phrase,
            "a growing concern",
            "an issue that is becoming more serious",
            &["This has become a growing concern.".to_string()],
            DictionaryContextTag::Reading,
            None,
            1_000,
        )
        .expect("entry must insert");

        let chunk = promote_dictionary_entry_to_chunk(&conn, entry_id, 1_500).expect("entry must promote");
        assert_eq!(chunk.origin, ChunkOrigin::DictionaryLookup);
        assert!(!chunk.is_promoted);

        let again = promote_dictionary_entry_to_chunk(&conn, entry_id, 2_000)
            .expect("re-promoting must return the existing chunk");
        assert_eq!(again.id, chunk.id);

        let entry = dictionary_entry_by_id(&conn, entry_id)
            .expect("entry must query")
            .expect("entry must exist");
        assert_eq!(entry.promoted_lexical_chunk_id, Some(chunk.id));
    }

    #[test]
    fn recording_a_promoted_chunks_review_outcome_advances_its_productive_status() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let (chunk_id, _) =
            create_chunk_candidate(&conn, sample_chunk_input("depending on the context"), 1_000)
                .expect("chunk must insert");
        promote_chunk_to_review(&conn, chunk_id, 1_500).expect("chunk must promote");

        let review_item_id: i64 = conn
            .query_row(
                "SELECT review_item_id FROM lexical_chunk WHERE id = ?1",
                params![chunk_id],
                |row| row.get(0),
            )
            .expect("review_item_id must be set");

        record_review_event_and_reschedule(&conn, review_item_id, None, ReviewOutcome::Remembered, 2_000)
            .expect("outcome must record");

        let (status, last_used_at): (String, Option<i64>) = conn
            .query_row(
                "SELECT productive_status, last_used_at FROM lexical_chunk WHERE id = ?1",
                params![chunk_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("chunk must read");
        assert_eq!(status, "recognized");
        assert_eq!(last_used_at, Some(2_000));
    }

    #[test]
    fn record_lexical_chunk_attempt_persists_row_and_updates_status() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let (chunk_id, _) =
            create_chunk_candidate(&conn, sample_chunk_input("concern"), 1_000).expect("chunk must insert");

        let updated = record_lexical_chunk_attempt(
            &conn,
            chunk_id,
            ExerciseType::UseInSentence,
            Modality::Written,
            "Use \"concern\" in a sentence.",
            "My main concern is the deadline.",
            ReviewOutcome::PartiallyRemembered,
            1_200,
        )
        .expect("attempt must record");
        assert_eq!(updated.productive_status, ProductiveStatus::UsedWithHelp);
        assert_eq!(updated.last_used_at, Some(1_200));

        let attempt_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lexical_chunk_attempt WHERE lexical_chunk_id = ?1",
                params![chunk_id],
                |row| row.get(0),
            )
            .expect("attempts must count");
        assert_eq!(attempt_count, 1);
    }

    fn sample_writing_evaluation(overall_level: CefrLevel) -> WritingEvaluationRecord {
        WritingEvaluationRecord {
            overall_level,
            rewrite_instruction: "Focus on professional collocations.".to_string(),
            dimensions: vec![
                writing::DimensionScoreRecord {
                    dimension: WritingDimension::TaskAchievement,
                    level: overall_level,
                    evidence: "States the purpose clearly.".to_string(),
                },
                writing::DimensionScoreRecord {
                    dimension: WritingDimension::LexicalResource,
                    level: overall_level,
                    evidence: "Uses varied vocabulary.".to_string(),
                },
            ],
            priority_issues: vec![writing::PriorityIssueRecord {
                category: WritingDimension::LexicalResource,
                original: "I have much experience".to_string(),
                suggested: "I have extensive experience".to_string(),
                explanation: "More natural professional collocation.".to_string(),
            }],
            useful_chunks: vec![writing::UsefulChunkRecord {
                chunk: "I have extensive experience with...".to_string(),
                register: "professional".to_string(),
                example: "I have extensive experience with React.".to_string(),
            }],
        }
    }

    #[test]
    fn writing_task_round_trip_persists_draft_and_rewrite_evaluations() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");

        let task_id = insert_writing_task(&conn, WritingTaskType::OpinionParagraph, CefrLevel::B2, 1_000)
            .expect("writing task must insert");

        let draft_evaluation = sample_writing_evaluation(CefrLevel::B1);
        record_writing_draft_evaluation(&mut conn, task_id, "I have much experience.", &draft_evaluation, 1_500)
            .expect("draft evaluation must persist");

        let rewrite_evaluation = sample_writing_evaluation(CefrLevel::B2);
        record_writing_rewrite_evaluation(
            &mut conn,
            task_id,
            "I have extensive experience.",
            &rewrite_evaluation,
            2_000,
        )
        .expect("rewrite evaluation must persist");

        let detail = writing_task_detail(&conn, task_id)
            .expect("detail must query")
            .expect("task must exist");
        assert_eq!(detail.task_type, WritingTaskType::OpinionParagraph);
        assert_eq!(detail.status, WritingTaskStatus::RewriteEvaluated);
        assert_eq!(detail.draft_text.as_deref(), Some("I have much experience."));
        assert_eq!(detail.rewrite_text.as_deref(), Some("I have extensive experience."));

        let (_, draft_record) = writing_evaluation_by_stage(&conn, task_id, WritingEvaluationStage::Draft)
            .expect("draft evaluation must query")
            .expect("draft evaluation must exist");
        assert_eq!(draft_record.overall_level, CefrLevel::B1);
        assert_eq!(draft_record.dimensions.len(), 2);
        assert_eq!(draft_record.priority_issues.len(), 1);
        assert_eq!(draft_record.useful_chunks.len(), 1);

        let (_, rewrite_record) = writing_evaluation_by_stage(&conn, task_id, WritingEvaluationStage::Rewrite)
            .expect("rewrite evaluation must query")
            .expect("rewrite evaluation must exist");
        assert_eq!(rewrite_record.overall_level, CefrLevel::B2);

        let recent = recent_writing_tasks(&conn, 10).expect("recent tasks must list");
        let summary = recent.iter().find(|task| task.id == task_id).expect("task must be listed");
        assert_eq!(summary.draft_overall_level, Some(CefrLevel::B1));
        assert_eq!(summary.rewrite_overall_level, Some(CefrLevel::B2));
    }

    #[test]
    fn reading_session_round_trip_persists_attempt_chunk_and_review_item() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");

        let attempt_id =
            insert_reading_session_attempt(&conn, "professional-email-project-delay", 1_000)
                .expect("attempt must insert");
        record_reading_comprehension_answer(&conn, attempt_id, true, 1_100)
            .expect("comprehension answer must persist");

        let (chunk_id, _) = create_chunk_candidate(
            &conn,
            ChunkCandidateInput {
                chunk_type: LexicalChunkType::Phrase,
                text: "rather than rush it and risk",
                meaning: "justifying caution over speed",
                register: "professional",
                target_level: CefrLevel::B2,
                domain: None,
                examples: &[],
                common_error: None,
                origin: ChunkOrigin::ReadingSession,
                source_correction_id: None,
                source_expression_id: None,
                source_repair_event_id: None,
                source_writing_evaluation_id: None,
                source_reading_session_attempt_id: Some(attempt_id),
                source_scenario_pack_id: None,
                source_dictionary_entry_id: None,
            },
            1_200,
        )
        .expect("chunk must insert");
        record_reading_selected_chunks(&conn, attempt_id, &[chunk_id])
            .expect("selected chunks must persist");

        let saved_chunk = lexical_chunk_by_id(&conn, chunk_id)
            .expect("chunk must query")
            .expect("chunk must exist");
        assert_eq!(saved_chunk.origin, ChunkOrigin::ReadingSession);

        let evaluation = reading::ReadingEvaluationRecord {
            summary_fidelity: reading::SummaryFidelity::Faithful,
            response_relevance: reading::ResponseRelevance::Relevant,
            priority_issues: vec![reading::ReadingPriorityIssueRecord {
                category: reading::ReadingIssueCategory::Summary,
                original: "the launch got faster".to_string(),
                suggested: "the launch was delayed".to_string(),
                explanation: "The summary reversed the direction of the change.".to_string(),
            }],
            useful_chunks: vec![reading::ReadingUsefulChunkRecord {
                chunk: "rather than rush it and risk".to_string(),
                register: "professional".to_string(),
                example: "Rather than rush it and risk a shaky rollout, we pushed the date.".to_string(),
            }],
        };
        record_reading_production_evaluation(
            &mut conn,
            attempt_id,
            "Jordan tells Priya the launch is delayed.",
            "That works for us, thanks for the update.",
            &evaluation,
            1_300,
        )
        .expect("evaluation must persist");

        let review_item_id = insert_review_item(
            &conn,
            ReviewItemType::Phrase,
            "rather than rush it and risk (e.g. \"...\")",
            ReviewSource::ReadingSession,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(attempt_id),
            1_300,
        )
        .expect("review item must insert");

        let (source, source_reading_session_attempt_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT source, source_reading_session_attempt_id FROM review_item WHERE id = ?1",
                params![review_item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("review_item must exist");
        assert_eq!(source, "reading_session");
        assert_eq!(source_reading_session_attempt_id, Some(attempt_id));

        let detail = reading_session_detail(&conn, attempt_id)
            .expect("detail must query")
            .expect("attempt must exist");
        assert_eq!(detail.status, reading::ReadingSessionStatus::Evaluated);
        assert_eq!(detail.comprehension_correct, Some(true));
        assert_eq!(detail.selected_chunk_ids, vec![chunk_id]);
        assert_eq!(
            detail.summary_text.as_deref(),
            Some("Jordan tells Priya the launch is delayed.")
        );
        assert!(detail.evaluation.is_some());
        assert_eq!(detail.spoken_response_text, None);
        assert_eq!(detail.spoken_response_submitted_at, None);

        let (_, saved_evaluation) = reading_evaluation_by_attempt(&conn, attempt_id)
            .expect("evaluation must query")
            .expect("evaluation must exist");
        assert_eq!(saved_evaluation.summary_fidelity, reading::SummaryFidelity::Faithful);
        assert_eq!(saved_evaluation.priority_issues.len(), 1);
        assert_eq!(saved_evaluation.useful_chunks.len(), 1);

        record_reading_spoken_response(&conn, attempt_id, "I think the launch got pushed back.", 1_400)
            .expect("spoken response must persist");
        let detail_after_spoken_response = reading_session_detail(&conn, attempt_id)
            .expect("detail must query")
            .expect("attempt must exist");
        assert_eq!(
            detail_after_spoken_response.spoken_response_text.as_deref(),
            Some("I think the launch got pushed back.")
        );
        assert_eq!(detail_after_spoken_response.spoken_response_submitted_at, Some(1_400));
    }

    #[test]
    fn migration_from_version_14_adds_spoken_response_columns_to_reading_session_attempt() {
        let (_directory, path) = scratch_db();

        let attempt_id = {
            let conn = Connection::open(&path).expect("connection must open");
            conn.execute_batch(
                "CREATE TABLE reading_session_attempt (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'reading',
                    comprehension_correct INTEGER,
                    comprehension_answered_at INTEGER,
                    selected_chunk_ids_json TEXT,
                    summary_text TEXT,
                    response_text TEXT,
                    production_submitted_at INTEGER,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE reading_session_evaluation (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reading_session_attempt_id INTEGER NOT NULL,
                    summary_fidelity TEXT NOT NULL,
                    response_relevance TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE lexical_chunk (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_type TEXT NOT NULL,
                    text TEXT NOT NULL,
                    normalized_text TEXT NOT NULL UNIQUE,
                    meaning TEXT NOT NULL,
                    register TEXT NOT NULL,
                    target_level TEXT NOT NULL,
                    domain TEXT,
                    examples_json TEXT NOT NULL,
                    common_error TEXT,
                    origin TEXT NOT NULL,
                    source_correction_id INTEGER,
                    source_expression_id INTEGER,
                    source_repair_event_id INTEGER,
                    source_writing_evaluation_id INTEGER,
                    source_reading_session_attempt_id INTEGER,
                    source_scenario_pack_id TEXT,
                    productive_status TEXT NOT NULL DEFAULT 'not_tried',
                    review_item_id INTEGER,
                    last_used_at INTEGER,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO reading_session_attempt (text_id, status, created_at)
                VALUES ('professional-email-project-delay', 'evaluated', 1000);",
            )
            .expect("v14 reading_session_attempt table must create");
            let attempt_id = conn.last_insert_rowid();
            conn.pragma_update(None, "user_version", 14)
                .expect("version must set");
            attempt_id
        };

        let conn = open_connection(&path).expect("connection must upgrade");
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version must read");
        assert_eq!(version, SCHEMA_VERSION);

        let detail = reading_session_detail(&conn, attempt_id)
            .expect("detail must query")
            .expect("attempt must exist");
        assert_eq!(detail.spoken_response_text, None);
        assert_eq!(detail.spoken_response_submitted_at, None);

        record_reading_spoken_response(&conn, attempt_id, "a spoken take on the update", 2_000)
            .expect("spoken response must persist after migration");
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
                "spoken",
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
            "typed",
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

        let user_turn_origin: String = conn
            .query_row(
                "SELECT origin FROM turn WHERE id = ?1",
                params![user_turn_id],
                |row| row.get(0),
            )
            .expect("user turn origin must be readable");
        assert_eq!(user_turn_origin, "typed");
        let assistant_turn_origin: String = conn
            .query_row(
                "SELECT origin FROM turn WHERE id = ?1",
                params![assistant_turn_id],
                |row| row.get(0),
            )
            .expect("assistant turn origin must be readable");
        assert_eq!(assistant_turn_origin, "spoken");

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
            "spoken",
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
            None,
            None,
            None,
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
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
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
                    VALUES ('I walked to the store', 'session_summary', 1000);
                CREATE TABLE review_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL CHECK (type IN (
                        'grammar_pattern', 'vocabulary', 'phrase', 'pronunciation_target', 'conversation_strategy'
                    )),
                    content TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('repair_event', 'session_summary', 'assessment_priority')),
                    source_repair_event_id INTEGER,
                    source_session_id INTEGER,
                    source_assessment_id INTEGER,
                    source_pronunciation_target_id INTEGER,
                    stage INTEGER NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 5),
                    next_review_at INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );",
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
            "spoken",
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
        record_turn_pair(&mut conn, session_id, "a", "b", &[], &[], "spoken", 2_000)
            .expect("first turn must record");
        record_turn_pair(&mut conn, session_id, "c", "d", &[], &[], "spoken", 3_000)
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
        record_turn_pair(&mut conn, with_turn, "hello there", "hi!", &[], &[], "spoken", 2_000)
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
            "typed",
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
            "spoken",
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

        assert_eq!(detail.turns[0].origin, "typed");
        assert_eq!(detail.turns[1].origin, "spoken");
        assert_eq!(detail.turns[2].origin, "spoken");
        assert_eq!(detail.turns[3].origin, "spoken");

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
            None,
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
                CREATE TABLE turn (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE TABLE correction (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    turn_id INTEGER NOT NULL REFERENCES turn(id) ON DELETE CASCADE,
                    original TEXT NOT NULL,
                    correction TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'naturalness', 'clarity')),
                    severity TEXT NOT NULL CHECK (severity IN ('minor', 'important'))
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

    #[test]
    fn recent_reading_sessions_orders_newest_first_and_reports_evaluation() {
        let (_directory, path) = scratch_db();
        let mut conn = open_connection(&path).expect("connection must open");

        let older_id = insert_reading_session_attempt(&conn, "professional-email-project-delay", 1_000)
            .expect("attempt must insert");
        let newer_id = insert_reading_session_attempt(&conn, "professional-email-project-delay", 2_000)
            .expect("attempt must insert");

        record_reading_production_evaluation(
            &mut conn,
            newer_id,
            "summary text",
            "response text",
            &reading::ReadingEvaluationRecord {
                summary_fidelity: reading::SummaryFidelity::Unfaithful,
                response_relevance: reading::ResponseRelevance::Relevant,
                priority_issues: Vec::new(),
                useful_chunks: Vec::new(),
            },
            2_100,
        )
        .expect("evaluation must persist");

        let results = recent_reading_sessions(&conn, 10).expect("results must query");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, newer_id);
        assert_eq!(results[0].summary_fidelity, Some(reading::SummaryFidelity::Unfaithful));
        assert_eq!(results[1].id, older_id);
        assert_eq!(results[1].summary_fidelity, None);
    }

    #[test]
    fn recent_lexical_chunk_attempts_joins_chunk_text_and_orders_newest_first() {
        let (_directory, path) = scratch_db();
        let conn = open_connection(&path).expect("connection must open");

        let (chunk_id, _) =
            create_chunk_candidate(&conn, sample_chunk_input("concern"), 1_000).expect("chunk must insert");

        record_lexical_chunk_attempt(
            &conn,
            chunk_id,
            ExerciseType::UseInSentence,
            Modality::Written,
            "Use \"concern\" in a sentence.",
            "My main concern is the deadline.",
            ReviewOutcome::Missed,
            1_200,
        )
        .expect("attempt must record");
        record_lexical_chunk_attempt(
            &conn,
            chunk_id,
            ExerciseType::UseInSentence,
            Modality::Written,
            "Use \"concern\" in a sentence.",
            "My main concern is the timeline.",
            ReviewOutcome::Remembered,
            1_400,
        )
        .expect("attempt must record");

        let results = recent_lexical_chunk_attempts(&conn, 10).expect("results must query");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].created_at, 1_400);
        assert_eq!(results[0].outcome, ReviewOutcome::Remembered);
        assert_eq!(results[0].chunk_text, "concern");
        assert_eq!(results[1].outcome, ReviewOutcome::Missed);
    }
}
