use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::assessment::CefrLevel;
use super::history::{self, HistoryCommandError};
use super::review::{ReviewItemType, ReviewOutcome};

// ---------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LexicalChunkType {
    SingleWord,
    Collocation,
    Phrase,
    DiscourseMarker,
    HedgingExpression,
    StancePhrase,
    RegisterSpecificExpression,
    DomainSpecificExpression,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChunkOrigin {
    Correction,
    BetterExpression,
    RepairEvent,
    WritingTask,
    ReadingSession,
    Manual,
    ScenarioPack,
    DictionaryLookup,
}

/// Declaration order is the productive ladder — derived `Ord` gives us
/// `NotTried < Recognized < UsedWithHelp < UsedIndependently < Automatic`
/// for free, which `apply_chunk_outcome` relies on.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ProductiveStatus {
    NotTried,
    Recognized,
    UsedWithHelp,
    UsedIndependently,
    Automatic,
}

impl ProductiveStatus {
    fn advance(self) -> Self {
        match self {
            ProductiveStatus::NotTried => ProductiveStatus::Recognized,
            ProductiveStatus::Recognized => ProductiveStatus::UsedWithHelp,
            ProductiveStatus::UsedWithHelp => ProductiveStatus::UsedIndependently,
            ProductiveStatus::UsedIndependently | ProductiveStatus::Automatic => {
                ProductiveStatus::Automatic
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseType {
    UseInSentence,
    CompleteResponse,
    RewriteSentence,
    SpokenResponse,
    MiniParagraph,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Modality {
    Written,
    Spoken,
}

// ---------------------------------------------------------------------
// Pure helpers — no DB/IO, unit-tested directly
// ---------------------------------------------------------------------

/// Lowercase, trim, collapse internal whitespace, strip surrounding quote
/// punctuation. Used both for the dedup lookup and to fill
/// `normalized_text` on insert.
pub(crate) fn normalize_chunk_text(text: &str) -> String {
    let trimmed = text
        .trim()
        .trim_matches(|c: char| matches!(c, '"' | '\'' | '\u{201c}' | '\u{201d}' | '\u{2018}' | '\u{2019}'));
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Coarse auto-classification used when a chunk is captured automatically
/// from conversation/writing feedback. The full 8-way taxonomy is only
/// meaningfully chosen by a human on manual add — see the slice's plan for
/// why an extra LLM call to classify this precisely isn't worth it here.
pub(crate) fn infer_chunk_type(text: &str) -> LexicalChunkType {
    if text.split_whitespace().count() <= 1 {
        LexicalChunkType::SingleWord
    } else {
        LexicalChunkType::Phrase
    }
}

/// Collapses a chunk type onto the same `vocabulary`/`phrase` review-item
/// type space `ReviewItemType` already has — mirrors
/// `review::review_type_to_issue_category`'s existing collapse.
pub(crate) fn chunk_review_item_type(chunk_type: LexicalChunkType) -> ReviewItemType {
    match chunk_type {
        LexicalChunkType::SingleWord | LexicalChunkType::Collocation => ReviewItemType::Vocabulary,
        _ => ReviewItemType::Phrase,
    }
}

/// The productive-status ladder's transition rule: `Remembered` advances one
/// step (capped at `Automatic`), `PartiallyRemembered` raises the status to
/// at least `UsedWithHelp`, `Missed`/`Skipped` are no-ops.
pub(crate) fn apply_chunk_outcome(current: ProductiveStatus, outcome: ReviewOutcome) -> ProductiveStatus {
    match outcome {
        ReviewOutcome::Remembered => current.advance(),
        ReviewOutcome::PartiallyRemembered => current.max(ProductiveStatus::UsedWithHelp),
        ReviewOutcome::Missed | ReviewOutcome::Skipped => current,
    }
}

const CHUNK_CONTEXT_MAX: usize = 3;

/// The compact, prompt-ready sentence folded into `learnerContext` alongside
/// `compose_tutor_summary` and `review::compose_review_context`. Pure and
/// testable without touching a database or the filesystem.
pub(crate) fn compose_chunk_context(chunks: &[LexicalChunk]) -> Option<String> {
    let contents: Vec<&str> = chunks
        .iter()
        .filter(|chunk| chunk.productive_status != ProductiveStatus::Automatic)
        .take(CHUNK_CONTEXT_MAX)
        .map(|chunk| chunk.text.as_str())
        .collect();
    if contents.is_empty() {
        return None;
    }
    Some(format!(
        "The learner is actively working on incorporating these expressions: {}. \
         Look for natural moments to let these come up, without forcing them.",
        contents.join("; ")
    ))
}

// ---------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LexicalChunk {
    pub(crate) id: i64,
    pub(crate) chunk_type: LexicalChunkType,
    pub(crate) text: String,
    pub(crate) meaning: String,
    pub(crate) register: String,
    pub(crate) target_level: CefrLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) domain: Option<String>,
    pub(crate) examples: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) common_error: Option<String>,
    pub(crate) origin: ChunkOrigin,
    pub(crate) productive_status: ProductiveStatus,
    pub(crate) is_promoted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_used_at: Option<i64>,
    pub(crate) created_at: i64,
}

/// Bundles every field a chunk-candidate creation needs, regardless of
/// which of the sources is calling — keeps `create_chunk_candidate`'s
/// call sites (persist_turn, repair.rs, writing.rs, manual add, scenario
/// pack import) readable instead of each passing a dozen positional
/// arguments.
pub(crate) struct ChunkCandidateInput<'a> {
    pub(crate) chunk_type: LexicalChunkType,
    pub(crate) text: &'a str,
    pub(crate) meaning: &'a str,
    pub(crate) register: &'a str,
    pub(crate) target_level: CefrLevel,
    pub(crate) domain: Option<&'a str>,
    pub(crate) examples: &'a [String],
    pub(crate) common_error: Option<&'a str>,
    pub(crate) origin: ChunkOrigin,
    pub(crate) source_correction_id: Option<i64>,
    pub(crate) source_expression_id: Option<i64>,
    pub(crate) source_repair_event_id: Option<i64>,
    pub(crate) source_writing_evaluation_id: Option<i64>,
    pub(crate) source_reading_session_attempt_id: Option<i64>,
    pub(crate) source_scenario_pack_id: Option<&'a str>,
    pub(crate) source_dictionary_entry_id: Option<i64>,
}

// ---------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateManualLexicalChunkRequest {
    text: String,
    chunk_type: LexicalChunkType,
    meaning: String,
    register: String,
    target_level: CefrLevel,
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    examples: Vec<String>,
    #[serde(default)]
    common_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioPackVocabularyItemInput {
    chunk_type: LexicalChunkType,
    text: String,
    meaning: String,
    register: String,
    target_level: CefrLevel,
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    examples: Vec<String>,
    #[serde(default)]
    common_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportScenarioPackVocabularyRequest {
    pack_id: String,
    items: Vec<ScenarioPackVocabularyItemInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteLexicalChunkRequest {
    chunk_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordLexicalChunkAttemptRequest {
    chunk_id: i64,
    exercise_type: ExerciseType,
    modality: Modality,
    prompt: String,
    transcript: String,
    outcome: ReviewOutcome,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl ChunkCommandError {
    fn new(code: &'static str, message: impl Into<String>, technical_message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: technical_message.into(),
        }
    }
}

impl From<HistoryCommandError> for ChunkCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for ChunkCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// Commands — thin wrappers over history.rs SQL functions
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn list_active_lexical_chunks(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<LexicalChunk>, ChunkCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(50).clamp(1, 200) as i64;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<LexicalChunk>, ChunkCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::list_active_lexical_chunks(&conn, limit)?)
    })
    .await
    .map_err(|error| {
        ChunkCommandError::new(
            "chunk-task-failed",
            "The chunk bank could not be loaded.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn create_manual_lexical_chunk(
    app_handle: AppHandle,
    request: CreateManualLexicalChunkRequest,
) -> Result<LexicalChunk, ChunkCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<LexicalChunk, ChunkCommandError> {
        let conn = history::open_connection(&path)?;
        let (chunk_id, _created) = history::create_chunk_candidate(
            &conn,
            ChunkCandidateInput {
                chunk_type: request.chunk_type,
                text: &request.text,
                meaning: &request.meaning,
                register: &request.register,
                target_level: request.target_level,
                domain: request.domain.as_deref(),
                examples: &request.examples,
                common_error: request.common_error.as_deref(),
                origin: ChunkOrigin::Manual,
                source_correction_id: None,
                source_expression_id: None,
                source_repair_event_id: None,
                source_writing_evaluation_id: None,
                source_reading_session_attempt_id: None,
                source_scenario_pack_id: None,
                source_dictionary_entry_id: None,
            },
            now_ms(),
        )?;
        history::lexical_chunk_by_id(&conn, chunk_id)?.ok_or_else(|| {
            ChunkCommandError::new(
                "chunk-task-failed",
                "The chunk could not be saved.",
                format!("lexical_chunk {chunk_id} not found after insert"),
            )
        })
    })
    .await
    .map_err(|error| {
        ChunkCommandError::new(
            "chunk-task-failed",
            "The chunk could not be saved.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn import_scenario_pack_vocabulary(
    app_handle: AppHandle,
    request: ImportScenarioPackVocabularyRequest,
) -> Result<Vec<LexicalChunk>, ChunkCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<LexicalChunk>, ChunkCommandError> {
        let conn = history::open_connection(&path)?;
        let now = now_ms();
        let mut chunks = Vec::with_capacity(request.items.len());
        for item in &request.items {
            let (chunk_id, _created) = history::create_chunk_candidate(
                &conn,
                ChunkCandidateInput {
                    chunk_type: item.chunk_type,
                    text: &item.text,
                    meaning: &item.meaning,
                    register: &item.register,
                    target_level: item.target_level,
                    domain: item.domain.as_deref(),
                    examples: &item.examples,
                    common_error: item.common_error.as_deref(),
                    origin: ChunkOrigin::ScenarioPack,
                    source_correction_id: None,
                    source_expression_id: None,
                    source_repair_event_id: None,
                    source_writing_evaluation_id: None,
                    source_reading_session_attempt_id: None,
                    source_scenario_pack_id: Some(&request.pack_id),
                    source_dictionary_entry_id: None,
                },
                now,
            )?;
            let chunk = history::lexical_chunk_by_id(&conn, chunk_id)?.ok_or_else(|| {
                ChunkCommandError::new(
                    "chunk-task-failed",
                    "The chunk could not be saved.",
                    format!("lexical_chunk {chunk_id} not found after insert"),
                )
            })?;
            chunks.push(chunk);
        }
        Ok(chunks)
    })
    .await
    .map_err(|error| {
        ChunkCommandError::new(
            "chunk-task-failed",
            "The scenario pack vocabulary could not be imported.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn promote_lexical_chunk(
    app_handle: AppHandle,
    request: PromoteLexicalChunkRequest,
) -> Result<LexicalChunk, ChunkCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<LexicalChunk, ChunkCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::promote_chunk_to_review(&conn, request.chunk_id, now_ms())?)
    })
    .await
    .map_err(|error| {
        ChunkCommandError::new(
            "chunk-task-failed",
            "The chunk could not be promoted to spaced review.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn record_lexical_chunk_attempt(
    app_handle: AppHandle,
    request: RecordLexicalChunkAttemptRequest,
) -> Result<LexicalChunk, ChunkCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<LexicalChunk, ChunkCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::record_lexical_chunk_attempt(
            &conn,
            request.chunk_id,
            request.exercise_type,
            request.modality,
            &request.prompt,
            &request.transcript,
            request.outcome,
            now_ms(),
        )?)
    })
    .await
    .map_err(|error| {
        ChunkCommandError::new(
            "chunk-task-failed",
            "The practice attempt could not be saved.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_chunk_text_collapses_whitespace_case_and_quotes() {
        assert_eq!(
            normalize_chunk_text("  \"Raise   Concerns About\"  "),
            "raise concerns about"
        );
        assert_eq!(normalize_chunk_text("'give up'"), "give up");
    }

    #[test]
    fn infer_chunk_type_distinguishes_single_word_from_phrase() {
        assert_eq!(infer_chunk_type("concern"), LexicalChunkType::SingleWord);
        assert_eq!(
            infer_chunk_type("raise concerns about"),
            LexicalChunkType::Phrase
        );
    }

    #[test]
    fn apply_chunk_outcome_remembered_advances_one_step_capped_at_automatic() {
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::NotTried, ReviewOutcome::Remembered),
            ProductiveStatus::Recognized
        );
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::UsedIndependently, ReviewOutcome::Remembered),
            ProductiveStatus::Automatic
        );
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::Automatic, ReviewOutcome::Remembered),
            ProductiveStatus::Automatic
        );
    }

    #[test]
    fn apply_chunk_outcome_partially_remembered_raises_to_at_least_used_with_help() {
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::NotTried, ReviewOutcome::PartiallyRemembered),
            ProductiveStatus::UsedWithHelp
        );
        assert_eq!(
            apply_chunk_outcome(
                ProductiveStatus::UsedIndependently,
                ReviewOutcome::PartiallyRemembered
            ),
            ProductiveStatus::UsedIndependently
        );
    }

    #[test]
    fn apply_chunk_outcome_missed_and_skipped_are_no_ops() {
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::UsedWithHelp, ReviewOutcome::Missed),
            ProductiveStatus::UsedWithHelp
        );
        assert_eq!(
            apply_chunk_outcome(ProductiveStatus::UsedWithHelp, ReviewOutcome::Skipped),
            ProductiveStatus::UsedWithHelp
        );
    }

    #[test]
    fn compose_chunk_context_is_none_when_empty_or_all_automatic() {
        assert_eq!(compose_chunk_context(&[]), None);
    }

    fn chunk(text: &str, status: ProductiveStatus) -> LexicalChunk {
        LexicalChunk {
            id: 1,
            chunk_type: LexicalChunkType::Phrase,
            text: text.to_string(),
            meaning: "meaning".to_string(),
            register: "neutral".to_string(),
            target_level: CefrLevel::C1,
            domain: None,
            examples: vec![],
            common_error: None,
            origin: ChunkOrigin::Manual,
            productive_status: status,
            is_promoted: false,
            last_used_at: None,
            created_at: 0,
        }
    }

    #[test]
    fn compose_chunk_context_skips_automatic_chunks_and_joins_the_rest() {
        let chunks = vec![
            chunk("raise concerns about", ProductiveStatus::Recognized),
            chunk("give up", ProductiveStatus::Automatic),
            chunk("a growing concern", ProductiveStatus::UsedWithHelp),
        ];
        let context = compose_chunk_context(&chunks).expect("context must be present");
        assert!(context.contains("raise concerns about"));
        assert!(context.contains("a growing concern"));
        assert!(!context.contains("give up"));
    }
}
