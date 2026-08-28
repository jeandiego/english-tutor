use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::history::{self, HistoryCommandError};
use super::repair::RepairPriority;
use super::tutor::{
    self, OllamaRequestMessage, TutorCommandError, TutorMessage, TutorMessageRole,
    TutorPerformance,
};

const MAX_HISTORY_MESSAGES: usize = 24;

const REVIEW_JUDGE_SYSTEM_INSTRUCTION: &str = r#"You are judging whether a learner just actively produced a specific item you were asked to help them practice earlier in this conversation. You do not converse with the learner. You will be given the item's type and content, followed by the learner's attempt as the final user message.

Judge only whether the attempt demonstrates active, correct use of the item's substance — a correct paraphrase or natural variation counts, not just an exact match to the wording. Judge on a spectrum:
- remembered: the learner used the item correctly and naturally.
- partially_remembered: the learner attempted it but got it partly wrong, or used a watered-down version.
- missed: the learner did not attempt it, avoided it, or got it clearly wrong.

Always return exactly this JSON object shape, using this exact field name:
{
  "outcome": "remembered" | "partially_remembered" | "missed"
}"#;

// ---------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewItemType {
    GrammarPattern,
    Vocabulary,
    Phrase,
    PronunciationTarget,
    ConversationStrategy,
}

fn review_item_type_label(item_type: ReviewItemType) -> &'static str {
    match item_type {
        ReviewItemType::GrammarPattern => "grammar pattern",
        ReviewItemType::Vocabulary => "vocabulary",
        ReviewItemType::Phrase => "phrase",
        ReviewItemType::PronunciationTarget => "pronunciation target",
        ReviewItemType::ConversationStrategy => "conversation strategy",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSource {
    RepairEvent,
    SessionSummary,
    AssessmentPriority,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOutcome {
    Remembered,
    PartiallyRemembered,
    Missed,
    Skipped,
}

/// Repair events already carry a priority that maps cleanly onto a review
/// item type — no LLM classification call is needed for this source, unlike
/// session summaries and assessment priorities where the type is authored
/// by the summarizing LLM itself (see `ReviewItemDraft`).
pub(crate) fn review_type_from_repair_priority(priority: RepairPriority) -> ReviewItemType {
    match priority {
        RepairPriority::Grammar => ReviewItemType::GrammarPattern,
        RepairPriority::Vocabulary => ReviewItemType::Vocabulary,
        RepairPriority::Pronunciation => ReviewItemType::PronunciationTarget,
        RepairPriority::Fluency | RepairPriority::Coherence | RepairPriority::Pragmatics => {
            ReviewItemType::ConversationStrategy
        }
    }
}

/// Collapses a review item type onto the existing recurring-issue category
/// space used by `learner_profile::category_label` — no new categories are
/// introduced, review signal just adds to the same buckets correction and
/// repair signal already feed.
pub(crate) fn review_type_to_issue_category(item_type: ReviewItemType) -> &'static str {
    match item_type {
        ReviewItemType::GrammarPattern => "grammar",
        ReviewItemType::Vocabulary | ReviewItemType::Phrase => "vocabulary",
        ReviewItemType::PronunciationTarget => "pronunciation",
        ReviewItemType::ConversationStrategy => "pragmatics",
    }
}

pub(crate) fn compose_review_content_from_repair(
    issue: &str,
    original: &str,
    suggested: &str,
) -> String {
    format!("{issue} — say \"{suggested}\" instead of \"{original}\"")
}

// ---------------------------------------------------------------------
// Scheduler — pure, unit-tested, no DB/IO
// ---------------------------------------------------------------------

const STAGE_INTERVALS_DAYS: [i64; 6] = [0, 1, 3, 7, 14, 30];
const DAY_MS: i64 = 86_400_000;
const MAX_STAGE: i32 = (STAGE_INTERVALS_DAYS.len() - 1) as i32;

/// The slice's scheduler: `None` means "no-op, don't touch the review_item
/// row" (only `Skipped` returns this — a skip is logged as an event but
/// never reschedules). Otherwise `Some((new_stage, next_review_at_ms))`.
pub(crate) fn apply_review_outcome(
    current_stage: i32,
    outcome: ReviewOutcome,
    now_ms: i64,
) -> Option<(i32, i64)> {
    match outcome {
        ReviewOutcome::Remembered => {
            let new_stage = (current_stage + 1).min(MAX_STAGE);
            Some((
                new_stage,
                now_ms + STAGE_INTERVALS_DAYS[new_stage as usize] * DAY_MS,
            ))
        }
        ReviewOutcome::PartiallyRemembered => Some((
            current_stage,
            now_ms + STAGE_INTERVALS_DAYS[current_stage as usize] * DAY_MS,
        )),
        ReviewOutcome::Missed => Some((0, now_ms)),
        ReviewOutcome::Skipped => None,
    }
}

// ---------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------

/// Emitted by the session-summary and assessment-summary LLM calls: each
/// item is classified with a type by the model itself at generation time.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewItemDraft {
    pub(crate) content: String,
    #[serde(rename = "type")]
    pub(crate) item_type: ReviewItemType,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub(crate) id: i64,
    #[serde(rename = "type")]
    pub(crate) item_type: ReviewItemType,
    pub(crate) content: String,
    pub(crate) source: ReviewSource,
    pub(crate) stage: i32,
    pub(crate) next_review_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_reviewed_at: Option<i64>,
    pub(crate) review_count: i64,
    pub(crate) created_at: i64,
}

/// The compact, prompt-ready sentence folded into `learnerContext` alongside
/// `compose_tutor_summary`'s own sentence. Pure and testable without
/// touching a database or the filesystem.
pub(crate) fn compose_review_context(items: &[ReviewItem]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let contents: Vec<&str> = items.iter().map(|item| item.content.as_str()).collect();
    Some(format!(
        "This session, help the learner actively produce: {}. Create one natural moment to prompt this — don't just show the answer.",
        contents.join("; ")
    ))
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEventSummary {
    pub(crate) review_item_id: i64,
    pub(crate) item_type: ReviewItemType,
    pub(crate) content: String,
    pub(crate) outcome: ReviewOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_id: Option<i64>,
    pub(crate) created_at: i64,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl ReviewCommandError {
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
}

impl From<TutorCommandError> for ReviewCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<HistoryCommandError> for ReviewCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for ReviewCommandError {
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
// Evaluator — judges a learner's attempt at a surfaced review item
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluateReviewAttemptRequest {
    item_type: ReviewItemType,
    content: String,
    transcript: String,
    #[serde(default)]
    history: Vec<TutorMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredReviewJudgment {
    outcome: ReviewOutcome,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAttemptEvaluation {
    outcome: ReviewOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn review_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "outcome": {
                "type": "string",
                "enum": ["remembered", "partially_remembered", "missed"]
            }
        },
        "required": ["outcome"]
    })
}

fn review_judge_messages(request: &EvaluateReviewAttemptRequest) -> Vec<OllamaRequestMessage> {
    let mut messages = vec![OllamaRequestMessage {
        role: "system",
        content: format!(
            "{}\n\nItem being practiced:\ntype: {}\ncontent: \"{}\"",
            REVIEW_JUDGE_SYSTEM_INSTRUCTION,
            review_item_type_label(request.item_type),
            request.content.trim(),
        ),
    }];

    let history_start = request.history.len().saturating_sub(MAX_HISTORY_MESSAGES);
    for message in request.history.iter().skip(history_start) {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        messages.push(OllamaRequestMessage {
            role: match message.role {
                TutorMessageRole::User => "user",
                TutorMessageRole::Assistant => "assistant",
            },
            content: content.to_string(),
        });
    }

    messages.push(OllamaRequestMessage {
        role: "user",
        content: request.transcript.trim().to_string(),
    });

    messages
}

async fn resolve_review_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, ReviewCommandError> {
    let path = tutor::config_path(app_handle)?;
    let settings = tutor::load_settings(path).await?;
    Ok(settings)
}

#[tauri::command]
pub async fn evaluate_review_attempt(
    app_handle: AppHandle,
    request: EvaluateReviewAttemptRequest,
) -> Result<ReviewAttemptEvaluation, ReviewCommandError> {
    let settings = resolve_review_settings(&app_handle).await?;
    let messages = review_judge_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: review_response_schema(),
            temperature: 0.2,
            think: false,
            request_failed_code: "review-request-failed",
            timeout_message: "The local tutor took too long to evaluate the review attempt.",
            failure_message: "The review evaluation request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredReviewJudgment>(&content).map_err(|error| {
        ReviewCommandError::new(
            "invalid-response",
            "The local tutor returned invalid structured output.",
            error.to_string(),
        )
    })?;

    Ok(ReviewAttemptEvaluation {
        outcome: parsed.outcome,
        performance,
    })
}

// ---------------------------------------------------------------------
// Persistence — thin wrappers over history.rs SQL functions
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn list_due_review_items(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<ReviewItem>, ReviewCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(3).clamp(1, 20) as i64;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ReviewItem>, ReviewCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::due_review_items(&conn, now_ms(), limit)?)
    })
    .await
    .map_err(|error| {
        ReviewCommandError::new(
            "review-task-failed",
            "The due review items could not be loaded.",
            error.to_string(),
        )
    })?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordReviewOutcomeRequest {
    review_item_id: i64,
    outcome: ReviewOutcome,
    #[serde(default)]
    session_id: Option<i64>,
}

#[tauri::command]
pub async fn record_review_outcome(
    app_handle: AppHandle,
    request: RecordReviewOutcomeRequest,
) -> Result<(), ReviewCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), ReviewCommandError> {
        let conn = history::open_connection(&path)?;
        history::record_review_event_and_reschedule(
            &conn,
            request.review_item_id,
            request.session_id,
            request.outcome,
            now_ms(),
        )?;
        Ok(())
    })
    .await
    .map_err(|error| {
        ReviewCommandError::new(
            "review-task-failed",
            "The review outcome could not be saved.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn list_recent_review_events(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<ReviewEventSummary>, ReviewCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(10).clamp(1, 50) as i64;
    tauri::async_runtime::spawn_blocking(
        move || -> Result<Vec<ReviewEventSummary>, ReviewCommandError> {
            let conn = history::open_connection(&path)?;
            Ok(history::recent_review_events(&conn, limit)?)
        },
    )
    .await
    .map_err(|error| {
        ReviewCommandError::new(
            "review-task-failed",
            "The review history could not be loaded.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(content: &str) -> ReviewItem {
        ReviewItem {
            id: 1,
            item_type: ReviewItemType::GrammarPattern,
            content: content.to_string(),
            source: ReviewSource::RepairEvent,
            stage: 0,
            next_review_at: 0,
            last_reviewed_at: None,
            review_count: 0,
            created_at: 0,
        }
    }

    #[test]
    fn apply_review_outcome_remembered_advances_stage_and_capped_at_max() {
        let (stage, next) = apply_review_outcome(0, ReviewOutcome::Remembered, 1_000)
            .expect("remembered must reschedule");
        assert_eq!(stage, 1);
        assert_eq!(next, 1_000 + 1 * DAY_MS);

        let (capped_stage, capped_next) = apply_review_outcome(5, ReviewOutcome::Remembered, 1_000)
            .expect("remembered at max stage must still reschedule");
        assert_eq!(capped_stage, 5);
        assert_eq!(capped_next, 1_000 + 30 * DAY_MS);
    }

    #[test]
    fn apply_review_outcome_partially_remembered_holds_stage_and_reanchors() {
        let (stage, next) = apply_review_outcome(2, ReviewOutcome::PartiallyRemembered, 1_000)
            .expect("partial must reschedule");
        assert_eq!(stage, 2);
        assert_eq!(next, 1_000 + 3 * DAY_MS);
    }

    #[test]
    fn apply_review_outcome_missed_resets_to_stage_zero_due_now() {
        let (stage, next) = apply_review_outcome(4, ReviewOutcome::Missed, 1_000)
            .expect("missed must reschedule");
        assert_eq!(stage, 0);
        assert_eq!(next, 1_000);
    }

    #[test]
    fn apply_review_outcome_skipped_is_a_no_op() {
        assert_eq!(apply_review_outcome(3, ReviewOutcome::Skipped, 1_000), None);
    }

    #[test]
    fn compose_review_context_is_none_when_empty() {
        assert_eq!(compose_review_context(&[]), None);
    }

    #[test]
    fn compose_review_context_joins_item_contents() {
        let items = vec![item("past tense forms"), item("phrasal verb: give up")];
        let context = compose_review_context(&items).expect("context must be present");
        assert!(context.contains("past tense forms"));
        assert!(context.contains("phrasal verb: give up"));
    }

    #[test]
    fn review_type_from_repair_priority_maps_as_expected() {
        assert_eq!(
            review_type_from_repair_priority(RepairPriority::Grammar),
            ReviewItemType::GrammarPattern
        );
        assert_eq!(
            review_type_from_repair_priority(RepairPriority::Fluency),
            ReviewItemType::ConversationStrategy
        );
        assert_eq!(
            review_type_from_repair_priority(RepairPriority::Coherence),
            ReviewItemType::ConversationStrategy
        );
        assert_eq!(
            review_type_from_repair_priority(RepairPriority::Pragmatics),
            ReviewItemType::ConversationStrategy
        );
    }

    #[test]
    fn review_type_to_issue_category_collapses_onto_existing_categories() {
        assert_eq!(
            review_type_to_issue_category(ReviewItemType::Vocabulary),
            "vocabulary"
        );
        assert_eq!(
            review_type_to_issue_category(ReviewItemType::Phrase),
            "vocabulary"
        );
        assert_eq!(
            review_type_to_issue_category(ReviewItemType::ConversationStrategy),
            "pragmatics"
        );
    }
}
