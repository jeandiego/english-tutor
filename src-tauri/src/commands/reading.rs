use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::assessment::CefrLevel;
use super::chunk::{ChunkCandidateInput, ChunkOrigin, LexicalChunk, LexicalChunkType};
use super::history::{self, HistoryCommandError};
use super::review::{ReviewItemType, ReviewSource};
use super::tutor::{self, OllamaRequestMessage, TutorCommandError, TutorPerformance};

const READING_EVALUATOR_SYSTEM_INSTRUCTION: &str = r#"You are evaluating a learner's written output for a reading-to-writing exercise in an English learning app. You do not converse with the learner. Your only job is to judge how well a summary and a response relate to a given source text, and return a structured, evidence-grounded evaluation.

You will be given: the source reading text, a summary prompt, a response prompt, the learner's summary, and the learner's response.

Judge selectively, not with a full rubric:
- summaryFidelity: does the summary accurately and concisely reflect the source text, without adding unsupported claims or missing the main point? One of "faithful", "partially_faithful", "unfaithful".
- responseRelevance: does the response engage substantively with the source text's content, on-topic and relevant to the response prompt? One of "relevant", "partially_relevant", "off_topic".

Then give 1 to 2 priority issues — the most important problems to fix in the summary or response, not every problem. For each: pick "summary" or "response" as its category, quote the exact original phrase, give a corrected or more natural version, and briefly explain why. Never return more than 2.

Then list 1 to 2 useful chunks: natural collocations or phrases the learner could adopt, drawn from the source text or natural English for this kind of writing, each with its register and one example sentence using it.

Never invent evidence. Judge only the English demonstrated in the summary and response given, using the source text as ground truth for fidelity.

Always return exactly this JSON object shape, using these exact field names:
{
  "summaryFidelity": "faithful",
  "responseRelevance": "relevant",
  "priorityIssues": [
    { "category": "summary", "original": "...", "suggested": "...", "explanation": "..." }
  ],
  "usefulChunks": [
    { "chunk": "...", "register": "neutral", "example": "..." }
  ]
}"#;

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl ReadingCommandError {
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

impl From<TutorCommandError> for ReadingCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<HistoryCommandError> for ReadingCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for ReadingCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

fn required_text(value: String, field: &str) -> Result<String, ReadingCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(ReadingCommandError::new(
            "invalid-response",
            "The reading evaluator returned an invalid structured response.",
            format!("The {field} field was empty."),
        ));
    }
    Ok(normalized)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

async fn run_blocking<T, F>(task: F) -> Result<T, ReadingCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ReadingCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            ReadingCommandError::new(
                "reading-task-failed",
                "The reading to writing request could not complete.",
                error.to_string(),
            )
        })?
}

// ---------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReadingSessionStatus {
    Reading,
    ComprehensionAnswered,
    ChunksSelected,
    SummarySubmitted,
    Evaluated,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SummaryFidelity {
    Faithful,
    PartiallyFaithful,
    Unfaithful,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseRelevance {
    Relevant,
    PartiallyRelevant,
    OffTopic,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReadingIssueCategory {
    Summary,
    Response,
}

const MIN_ACCEPTED_CHUNKS: usize = 3;
const MAX_ACCEPTED_CHUNKS: usize = 5;

/// Deterministic grading — unlike Listening's LLM-generated checks, the
/// question and correct answer are authored per-text in local JSON, so no
/// LLM call is needed to grade a multiple-choice answer.
pub(crate) fn grade_reading_comprehension(correct_option_index: i64, selected_option_index: i64) -> bool {
    correct_option_index == selected_option_index
}

/// The doc's flow asks for 3 to 5 accepted chunks per session — enforced
/// server-side so the acceptance criterion is testable independent of the
/// frontend's own guard.
pub(crate) fn validate_chunk_selection_count(count: usize) -> Result<(), ReadingCommandError> {
    if count < MIN_ACCEPTED_CHUNKS || count > MAX_ACCEPTED_CHUNKS {
        return Err(ReadingCommandError::new(
            "invalid-chunk-selection",
            "Select between 3 and 5 chunks before continuing.",
            format!("received {count} chunks, expected {MIN_ACCEPTED_CHUNKS}-{MAX_ACCEPTED_CHUNKS}"),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Evaluation records — the shape shared between the LLM response, SQL
// persistence, and the response sent back to the frontend.
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadingPriorityIssueRecord {
    pub(crate) category: ReadingIssueCategory,
    pub(crate) original: String,
    pub(crate) suggested: String,
    pub(crate) explanation: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadingUsefulChunkRecord {
    pub(crate) chunk: String,
    pub(crate) register: String,
    pub(crate) example: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadingEvaluationRecord {
    pub(crate) summary_fidelity: SummaryFidelity,
    pub(crate) response_relevance: ResponseRelevance,
    pub(crate) priority_issues: Vec<ReadingPriorityIssueRecord>,
    pub(crate) useful_chunks: Vec<ReadingUsefulChunkRecord>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingEvaluationResult {
    id: i64,
    #[serde(flatten)]
    evaluation: ReadingEvaluationRecord,
}

pub(crate) fn reading_evaluation_result_from_record(
    id: i64,
    evaluation: ReadingEvaluationRecord,
) -> ReadingEvaluationResult {
    ReadingEvaluationResult { id, evaluation }
}

/// Maps the evaluation's priority issues and useful chunks onto review-item
/// drafts, mirroring `writing::review_drafts_from_evaluation` — but capped
/// at 2 total (not appended unbounded) since the doc's own manual test
/// expects "1 or 2 items" to show up for future review, lighter than
/// Writing Gym's up-to-7.
pub(crate) fn review_drafts_from_reading_evaluation(
    record: &ReadingEvaluationRecord,
) -> Vec<(ReviewItemType, String)> {
    let mut drafts = Vec::new();
    for issue in &record.priority_issues {
        drafts.push((
            ReviewItemType::Phrase,
            format!(
                "{} — say \"{}\" instead of \"{}\"",
                issue.explanation, issue.suggested, issue.original
            ),
        ));
    }
    for chunk in &record.useful_chunks {
        drafts.push((
            ReviewItemType::Phrase,
            format!("{} (e.g. \"{}\")", chunk.chunk, chunk.example),
        ));
    }
    drafts.truncate(2);
    drafts
}

// ---------------------------------------------------------------------
// Evaluator — LLM call
// ---------------------------------------------------------------------

fn reading_evaluation_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "summaryFidelity": { "type": "string", "enum": ["faithful", "partially_faithful", "unfaithful"] },
            "responseRelevance": { "type": "string", "enum": ["relevant", "partially_relevant", "off_topic"] },
            "priorityIssues": {
                "type": "array",
                "minItems": 1,
                "maxItems": 2,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "category": { "type": "string", "enum": ["summary", "response"] },
                        "original": { "type": "string", "minLength": 1 },
                        "suggested": { "type": "string", "minLength": 1 },
                        "explanation": { "type": "string", "minLength": 1 }
                    },
                    "required": ["category", "original", "suggested", "explanation"]
                }
            },
            "usefulChunks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 2,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "chunk": { "type": "string", "minLength": 1 },
                        "register": { "type": "string", "minLength": 1 },
                        "example": { "type": "string", "minLength": 1 }
                    },
                    "required": ["chunk", "register", "example"]
                }
            }
        },
        "required": ["summaryFidelity", "responseRelevance", "priorityIssues", "usefulChunks"]
    })
}

fn reading_evaluation_messages(
    reading_text_body: &str,
    summary_prompt: &str,
    response_prompt: &str,
    summary_text: &str,
    response_text: &str,
) -> Vec<OllamaRequestMessage> {
    let user_content = format!(
        "Source text:\n{}\n\nSummary prompt: {}\nResponse prompt: {}\n\nLearner's summary:\n{}\n\nLearner's response:\n{}",
        reading_text_body.trim(),
        summary_prompt,
        response_prompt,
        summary_text.trim(),
        response_text.trim(),
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: READING_EVALUATOR_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredPriorityIssue {
    category: ReadingIssueCategory,
    original: String,
    suggested: String,
    explanation: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredUsefulChunk {
    chunk: String,
    register: String,
    example: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredReadingEvaluation {
    summary_fidelity: SummaryFidelity,
    response_relevance: ResponseRelevance,
    priority_issues: Vec<StructuredPriorityIssue>,
    useful_chunks: Vec<StructuredUsefulChunk>,
}

impl StructuredReadingEvaluation {
    fn validated(mut self) -> Result<Self, ReadingCommandError> {
        if self.priority_issues.is_empty() || self.priority_issues.len() > 2 {
            return Err(ReadingCommandError::new(
                "invalid-response",
                "The reading evaluator did not return between 1 and 2 priority issues.",
                format!("priorityIssues length: {}", self.priority_issues.len()),
            ));
        }
        if self.useful_chunks.is_empty() || self.useful_chunks.len() > 2 {
            return Err(ReadingCommandError::new(
                "invalid-response",
                "The reading evaluator did not return between 1 and 2 useful chunks.",
                format!("usefulChunks length: {}", self.useful_chunks.len()),
            ));
        }

        for (index, issue) in self.priority_issues.iter_mut().enumerate() {
            issue.original = required_text(
                std::mem::take(&mut issue.original),
                &format!("priorityIssues[{index}].original"),
            )?;
            issue.suggested = required_text(
                std::mem::take(&mut issue.suggested),
                &format!("priorityIssues[{index}].suggested"),
            )?;
            issue.explanation = required_text(
                std::mem::take(&mut issue.explanation),
                &format!("priorityIssues[{index}].explanation"),
            )?;
        }
        for (index, chunk) in self.useful_chunks.iter_mut().enumerate() {
            chunk.chunk = required_text(
                std::mem::take(&mut chunk.chunk),
                &format!("usefulChunks[{index}].chunk"),
            )?;
            chunk.register = required_text(
                std::mem::take(&mut chunk.register),
                &format!("usefulChunks[{index}].register"),
            )?;
            chunk.example = required_text(
                std::mem::take(&mut chunk.example),
                &format!("usefulChunks[{index}].example"),
            )?;
        }

        Ok(self)
    }
}

impl From<StructuredReadingEvaluation> for ReadingEvaluationRecord {
    fn from(value: StructuredReadingEvaluation) -> Self {
        Self {
            summary_fidelity: value.summary_fidelity,
            response_relevance: value.response_relevance,
            priority_issues: value
                .priority_issues
                .into_iter()
                .map(|issue| ReadingPriorityIssueRecord {
                    category: issue.category,
                    original: issue.original,
                    suggested: issue.suggested,
                    explanation: issue.explanation,
                })
                .collect(),
            useful_chunks: value
                .useful_chunks
                .into_iter()
                .map(|chunk| ReadingUsefulChunkRecord {
                    chunk: chunk.chunk,
                    register: chunk.register,
                    example: chunk.example,
                })
                .collect(),
        }
    }
}

async fn resolve_reading_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, ReadingCommandError> {
    let path = tutor::config_path(app_handle)?;
    Ok(tutor::load_settings(path).await?)
}

async fn evaluate_reading_production(
    app_handle: &AppHandle,
    reading_text_body: &str,
    summary_prompt: &str,
    response_prompt: &str,
    summary_text: &str,
    response_text: &str,
) -> Result<(ReadingEvaluationRecord, Option<TutorPerformance>), ReadingCommandError> {
    let settings = resolve_reading_settings(app_handle).await?;
    let messages = reading_evaluation_messages(
        reading_text_body,
        summary_prompt,
        response_prompt,
        summary_text,
        response_text,
    );
    let (content, performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: reading_evaluation_response_schema(),
            temperature: 0.3,
            think: false,
            request_failed_code: "reading-request-failed",
            timeout_message: "The local tutor took too long to evaluate the reading response.",
            failure_message: "The reading evaluation request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredReadingEvaluation>(&content)
        .map_err(|error| {
            ReadingCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;
    Ok((parsed.into(), performance))
}

// ---------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSessionAttempt {
    id: i64,
    text_id: String,
    status: ReadingSessionStatus,
    created_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingComprehensionResult {
    is_correct: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSessionDetail {
    pub(crate) id: i64,
    pub(crate) text_id: String,
    pub(crate) status: ReadingSessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) comprehension_correct: Option<bool>,
    pub(crate) selected_chunk_ids: Vec<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) summary_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) response_text: Option<String>,
    pub(crate) created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) evaluation: Option<ReadingEvaluationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) spoken_response_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) spoken_response_submitted_at: Option<i64>,
}

/// Lightweight row for feed/list views (e.g. the journey checkpoint feed)
/// that don't need the full evaluation record.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSessionSummary {
    pub(crate) id: i64,
    pub(crate) text_id: String,
    pub(crate) status: ReadingSessionStatus,
    pub(crate) created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) summary_fidelity: Option<SummaryFidelity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) response_relevance: Option<ResponseRelevance>,
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartReadingSessionRequest {
    text_id: String,
}

#[tauri::command]
pub async fn start_reading_session(
    app_handle: AppHandle,
    request: StartReadingSessionRequest,
) -> Result<ReadingSessionAttempt, ReadingCommandError> {
    let path = history::db_path(&app_handle)?;
    let text_id = request.text_id;
    let created_at = now_ms();
    run_blocking(move || -> Result<ReadingSessionAttempt, ReadingCommandError> {
        let conn = history::open_connection(&path)?;
        let id = history::insert_reading_session_attempt(&conn, &text_id, created_at)?;
        Ok(ReadingSessionAttempt {
            id,
            text_id,
            status: ReadingSessionStatus::Reading,
            created_at,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReadingComprehensionAnswerRequest {
    attempt_id: i64,
    correct_option_index: i64,
    selected_option_index: i64,
}

#[tauri::command]
pub async fn submit_reading_comprehension_answer(
    app_handle: AppHandle,
    request: SubmitReadingComprehensionAnswerRequest,
) -> Result<ReadingComprehensionResult, ReadingCommandError> {
    let path = history::db_path(&app_handle)?;
    let is_correct =
        grade_reading_comprehension(request.correct_option_index, request.selected_option_index);
    let attempt_id = request.attempt_id;
    let now = now_ms();
    run_blocking(move || -> Result<ReadingComprehensionResult, ReadingCommandError> {
        let conn = history::open_connection(&path)?;
        history::record_reading_comprehension_answer(&conn, attempt_id, is_correct, now)?;
        Ok(ReadingComprehensionResult { is_correct })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingChunkCandidateInput {
    chunk_type: LexicalChunkType,
    text: String,
    meaning: String,
    register: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptReadingChunksRequest {
    attempt_id: i64,
    target_level: CefrLevel,
    chunks: Vec<ReadingChunkCandidateInput>,
}

#[tauri::command]
pub async fn accept_reading_chunks(
    app_handle: AppHandle,
    request: AcceptReadingChunksRequest,
) -> Result<Vec<LexicalChunk>, ReadingCommandError> {
    validate_chunk_selection_count(request.chunks.len())?;
    let path = history::db_path(&app_handle)?;
    let attempt_id = request.attempt_id;
    let target_level = request.target_level;
    let chunks = request.chunks;
    let now = now_ms();
    run_blocking(move || -> Result<Vec<LexicalChunk>, ReadingCommandError> {
        let conn = history::open_connection(&path)?;
        let mut created = Vec::with_capacity(chunks.len());
        let mut chunk_ids = Vec::with_capacity(chunks.len());
        for candidate in &chunks {
            let (chunk_id, _created) = history::create_chunk_candidate(
                &conn,
                ChunkCandidateInput {
                    chunk_type: candidate.chunk_type,
                    text: &candidate.text,
                    meaning: &candidate.meaning,
                    register: &candidate.register,
                    target_level,
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
                now,
            )?;
            let chunk = history::lexical_chunk_by_id(&conn, chunk_id)?.ok_or_else(|| {
                ReadingCommandError::new(
                    "reading-task-failed",
                    "The chunk could not be saved.",
                    format!("lexical_chunk {chunk_id} not found after insert"),
                )
            })?;
            chunk_ids.push(chunk_id);
            created.push(chunk);
        }
        history::record_reading_selected_chunks(&conn, attempt_id, &chunk_ids)?;
        Ok(created)
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReadingProductionRequest {
    attempt_id: i64,
    reading_text_body: String,
    summary_prompt: String,
    response_prompt: String,
    summary_text: String,
    response_text: String,
}

#[tauri::command]
pub async fn submit_reading_production(
    app_handle: AppHandle,
    request: SubmitReadingProductionRequest,
) -> Result<ReadingEvaluationResult, ReadingCommandError> {
    if request.summary_text.trim().is_empty() {
        return Err(ReadingCommandError::new(
            "empty-summary",
            "Write a summary before submitting it for feedback.",
            "summaryText was empty",
        ));
    }
    if request.response_text.trim().is_empty() {
        return Err(ReadingCommandError::new(
            "empty-response",
            "Write a response before submitting it for feedback.",
            "responseText was empty",
        ));
    }
    let summary_text = request.summary_text.trim().to_string();
    let response_text = request.response_text.trim().to_string();

    let (evaluation, _performance) = evaluate_reading_production(
        &app_handle,
        &request.reading_text_body,
        &request.summary_prompt,
        &request.response_prompt,
        &summary_text,
        &response_text,
    )
    .await?;

    let path = history::db_path(&app_handle)?;
    let attempt_id = request.attempt_id;
    let now = now_ms();
    let evaluation_for_db = evaluation.clone();
    let evaluation_id = run_blocking(move || -> Result<i64, ReadingCommandError> {
        let mut conn = history::open_connection(&path)?;
        let evaluation_id = history::record_reading_production_evaluation(
            &mut conn,
            attempt_id,
            &summary_text,
            &response_text,
            &evaluation_for_db,
            now,
        )?;
        for (item_type, content) in review_drafts_from_reading_evaluation(&evaluation_for_db) {
            history::insert_review_item(
                &conn,
                item_type,
                &content,
                ReviewSource::ReadingSession,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(attempt_id),
                now,
            )?;
        }
        Ok(evaluation_id)
    })
    .await?;

    Ok(reading_evaluation_result_from_record(evaluation_id, evaluation))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitReadingSpokenResponseRequest {
    attempt_id: i64,
    spoken_response_text: String,
}

#[tauri::command]
pub async fn submit_reading_spoken_response(
    app_handle: AppHandle,
    request: SubmitReadingSpokenResponseRequest,
) -> Result<(), ReadingCommandError> {
    if request.spoken_response_text.trim().is_empty() {
        return Err(ReadingCommandError::new(
            "empty-spoken-response",
            "The spoken response was empty.",
            "spokenResponseText was empty",
        ));
    }
    let path = history::db_path(&app_handle)?;
    let attempt_id = request.attempt_id;
    let spoken_response_text = request.spoken_response_text.trim().to_string();
    let now = now_ms();
    run_blocking(move || -> Result<(), ReadingCommandError> {
        let conn = history::open_connection(&path)?;
        history::record_reading_spoken_response(&conn, attempt_id, &spoken_response_text, now)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_reading_session(
    app_handle: AppHandle,
    attempt_id: i64,
) -> Result<ReadingSessionDetail, ReadingCommandError> {
    let path = history::db_path(&app_handle)?;
    run_blocking(move || -> Result<ReadingSessionDetail, ReadingCommandError> {
        let conn = history::open_connection(&path)?;
        history::reading_session_detail(&conn, attempt_id)?.ok_or_else(|| {
            ReadingCommandError::new(
                "not-found",
                "That reading session could not be found.",
                format!("reading_session_attempt {attempt_id} not found"),
            )
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grade_reading_comprehension_matches_correct_index_only() {
        assert!(grade_reading_comprehension(1, 1));
        assert!(!grade_reading_comprehension(1, 0));
        assert!(!grade_reading_comprehension(1, 2));
    }

    #[test]
    fn validate_chunk_selection_count_accepts_three_to_five() {
        assert!(validate_chunk_selection_count(3).is_ok());
        assert!(validate_chunk_selection_count(5).is_ok());
    }

    #[test]
    fn validate_chunk_selection_count_rejects_outside_three_to_five() {
        assert!(validate_chunk_selection_count(2).is_err());
        assert!(validate_chunk_selection_count(6).is_err());
        assert!(validate_chunk_selection_count(0).is_err());
    }

    fn valid_evaluation() -> StructuredReadingEvaluation {
        StructuredReadingEvaluation {
            summary_fidelity: SummaryFidelity::Faithful,
            response_relevance: ResponseRelevance::Relevant,
            priority_issues: vec![StructuredPriorityIssue {
                category: ReadingIssueCategory::Summary,
                original: "the app got slower".to_string(),
                suggested: "the app's cold-start time improved".to_string(),
                explanation: "The summary reversed the direction of the change described in the source.".to_string(),
            }],
            useful_chunks: vec![StructuredUsefulChunk {
                chunk: "roll out to all users".to_string(),
                register: "neutral".to_string(),
                example: "Version 4.2 is rolling out to all users this week.".to_string(),
            }],
        }
    }

    #[test]
    fn validated_accepts_a_well_formed_payload() {
        assert!(valid_evaluation().validated().is_ok());
    }

    #[test]
    fn validated_rejects_zero_priority_issues() {
        let mut evaluation = valid_evaluation();
        evaluation.priority_issues.clear();
        let error = evaluation.validated().expect_err("must reject empty priority issues");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_more_than_two_priority_issues() {
        let mut evaluation = valid_evaluation();
        let issue = evaluation.priority_issues[0].clone();
        evaluation.priority_issues = vec![issue.clone(), issue.clone(), issue];
        let error = evaluation
            .validated()
            .expect_err("must reject more than 2 priority issues");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_empty_useful_chunks() {
        let mut evaluation = valid_evaluation();
        evaluation.useful_chunks.clear();
        let error = evaluation.validated().expect_err("must reject empty useful chunks");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_blank_fields_after_trim() {
        let mut evaluation = valid_evaluation();
        evaluation.priority_issues[0].suggested = "   ".to_string();
        let error = evaluation.validated().expect_err("must reject blank suggested field");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn review_drafts_from_reading_evaluation_caps_at_two_and_includes_issues_and_chunks() {
        let record: ReadingEvaluationRecord = valid_evaluation().validated().unwrap().into();
        let drafts = review_drafts_from_reading_evaluation(&record);
        assert_eq!(drafts.len(), 2);
        assert!(drafts[0].1.contains("cold-start time improved"));
        assert!(drafts[1].1.contains("roll out to all users"));
    }
}
