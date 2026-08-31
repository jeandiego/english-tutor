use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::history::{self, HistoryCommandError};
use super::learner_profile::{self, LearnerProfileCommandError, ListeningAccentFocus};
use super::tutor::{self, OllamaRequestMessage, TutorCommandError, TutorMessage, TutorMessageRole};

// ---------------------------------------------------------------------
// Domain enums / data shapes
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListeningCheckType {
    DetailQuestion,
    SummaryChoice,
    RepeatOwnWords,
    DetailFollowup,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComprehensionCheck {
    pub(crate) id: i64,
    pub(crate) check_type: ListeningCheckType,
    pub(crate) question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) options: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListeningCheckResult {
    pub(crate) is_correct: bool,
    pub(crate) feedback: String,
    pub(crate) new_stage: i32,
}

// ---------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateComprehensionCheckRequest {
    #[serde(default)]
    session_id: Option<i64>,
    tutor_reply: String,
    #[serde(default)]
    recent_history: Vec<TutorMessage>,
    #[serde(default)]
    accent_focus: Option<ListeningAccentFocus>,
    stage: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitListeningCheckAttemptRequest {
    check_id: i64,
    answer: String,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListeningCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl ListeningCommandError {
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

impl From<HistoryCommandError> for ListeningCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for ListeningCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

impl From<TutorCommandError> for ListeningCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<LearnerProfileCommandError> for ListeningCommandError {
    fn from(error: LearnerProfileCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// Pure grading core — no DB/IO, unit-tested directly
// ---------------------------------------------------------------------

fn grade_multiple_choice(correct_option_index: i64, options: &[String], answer: &str) -> bool {
    let trimmed = answer.trim();
    if trimmed == correct_option_index.to_string() {
        return true;
    }
    options
        .get(correct_option_index as usize)
        .map(|correct| correct.trim().eq_ignore_ascii_case(trimmed))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------
// Check generation (structured LLM call)
// ---------------------------------------------------------------------

const MAX_HISTORY_MESSAGES: usize = 8;

const CHECK_GENERATION_SYSTEM_INSTRUCTION: &str = r#"You are the listening-comprehension checker for an English conversation tutor. You do not converse with the learner — you silently review the tutor's most recent spoken reply (given as the final user message) and prepare ONE comprehension check about it.

Pick exactly one check type, matched to what makes sense for this reply:
- detail_question: ask a direct question about a specific detail the tutor just said.
- summary_choice: give a short question plus exactly 3 short summary options describing what the tutor just said, only one of which is accurate.
- repeat_own_words: ask the learner to repeat or paraphrase what the tutor just said, in their own words.
- detail_followup: ask a natural follow-up question that can only be answered correctly if the learner understood a specific detail.

For summary_choice, write exactly 3 options and identify the correct one with correctOptionIndex (0, 1, or 2) — the other two must be plausible but wrong.
For every other check type, write expectedCriteria: a short description of what a correct answer must contain. Never write a template answer, and never leak the answer into the question itself.

Keep the question itself short and natural, spoken-style — one sentence.

Always return exactly this JSON object shape, using these exact field names:
{
  "checkType": "detail_question | summary_choice | repeat_own_words | detail_followup",
  "question": "the check question",
  "options": ["option one", "option two", "option three"],
  "correctOptionIndex": 0,
  "expectedCriteria": "what a correct answer must contain"
}
Only include options/correctOptionIndex when checkType is summary_choice. Only include expectedCriteria otherwise."#;

fn accent_focus_label(focus: ListeningAccentFocus) -> &'static str {
    match focus {
        ListeningAccentFocus::American => "American English",
        ListeningAccentFocus::British => "British English",
        ListeningAccentFocus::Mixed => "mixed English accents",
        ListeningAccentFocus::SoftwareWorkplace => "software and workplace English",
        ListeningAccentFocus::TravelEveryday => "travel and everyday English",
    }
}

fn check_generation_messages(request: &GenerateComprehensionCheckRequest) -> Vec<OllamaRequestMessage> {
    let mut messages = vec![OllamaRequestMessage {
        role: "system",
        content: CHECK_GENERATION_SYSTEM_INSTRUCTION.to_string(),
    }];

    if let Some(focus) = request.accent_focus {
        messages.push(OllamaRequestMessage {
            role: "system",
            content: format!(
                "The learner's listening focus is {}.",
                accent_focus_label(focus)
            ),
        });
    }

    let history_start = request
        .recent_history
        .len()
        .saturating_sub(MAX_HISTORY_MESSAGES);
    for message in request.recent_history.iter().skip(history_start) {
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
        content: format!(
            "Tutor's most recent reply: \"{}\"",
            request.tutor_reply.trim()
        ),
    });

    messages
}

fn check_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "checkType": {
                "type": "string",
                "enum": ["detail_question", "summary_choice", "repeat_own_words", "detail_followup"]
            },
            "question": { "type": "string", "minLength": 1 },
            "options": {
                "type": "array",
                "items": { "type": "string" }
            },
            "correctOptionIndex": { "type": "integer" },
            "expectedCriteria": { "type": "string" }
        },
        "required": ["checkType", "question"]
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredCheck {
    check_type: ListeningCheckType,
    question: String,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    correct_option_index: Option<i64>,
    #[serde(default)]
    expected_criteria: Option<String>,
}

impl StructuredCheck {
    fn validated(self) -> Result<Self, ListeningCommandError> {
        if self.question.trim().is_empty() {
            return Err(ListeningCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                "question was empty",
            ));
        }

        match self.check_type {
            ListeningCheckType::SummaryChoice => {
                if self.options.len() != 3 {
                    return Err(ListeningCommandError::new(
                        "invalid-response",
                        "The local tutor returned invalid structured output.",
                        format!("summary_choice expected 3 options, got {}", self.options.len()),
                    ));
                }
                let index = self.correct_option_index.ok_or_else(|| {
                    ListeningCommandError::new(
                        "invalid-response",
                        "The local tutor returned invalid structured output.",
                        "summary_choice missing correctOptionIndex",
                    )
                })?;
                if !(0..3).contains(&index) {
                    return Err(ListeningCommandError::new(
                        "invalid-response",
                        "The local tutor returned invalid structured output.",
                        format!("correctOptionIndex {index} out of range"),
                    ));
                }
            }
            _ => {
                let criteria = self.expected_criteria.as_deref().unwrap_or("").trim();
                if criteria.is_empty() {
                    return Err(ListeningCommandError::new(
                        "invalid-response",
                        "The local tutor returned invalid structured output.",
                        "expectedCriteria was empty",
                    ));
                }
            }
        }

        Ok(self)
    }
}

// ---------------------------------------------------------------------
// Free-text grading (structured LLM call)
// ---------------------------------------------------------------------

const GRADE_SYSTEM_INSTRUCTION: &str = r#"You are grading a learner's answer to a listening-comprehension check for an English conversation tutor. You do not converse with the learner. You will be given the tutor's original spoken reply, the check question, and what a correct answer must contain, followed by the learner's answer as the final user message.

Judge only whether the learner's answer demonstrates they understood the relevant detail — accept paraphrases and minor wording differences, and be lenient about grammar/spelling since the answer may come from speech transcription. Write one short, encouraging sentence of feedback either way.

Always return exactly this JSON object shape, using these exact field names:
{
  "isCorrect": true,
  "feedback": "one short sentence of feedback"
}"#;

fn grade_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "isCorrect": { "type": "boolean" },
            "feedback": { "type": "string", "minLength": 1 }
        },
        "required": ["isCorrect", "feedback"]
    })
}

fn grade_messages(
    tutor_reply: &str,
    question: &str,
    expected_criteria: &str,
    answer: &str,
) -> Vec<OllamaRequestMessage> {
    vec![
        OllamaRequestMessage {
            role: "system",
            content: format!(
                "{}\n\nTutor's original reply: \"{}\"\nCheck question: \"{}\"\nA correct answer must contain: {}",
                GRADE_SYSTEM_INSTRUCTION,
                tutor_reply.trim(),
                question.trim(),
                expected_criteria.trim(),
            ),
        },
        OllamaRequestMessage {
            role: "user",
            content: answer.trim().to_string(),
        },
    ]
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredGrade {
    is_correct: bool,
    feedback: String,
}

async fn resolve_listening_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, ListeningCommandError> {
    let path = tutor::config_path(app_handle)?;
    let settings = tutor::load_settings(path).await?;
    Ok(settings)
}

// ---------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn generate_comprehension_check(
    app_handle: AppHandle,
    request: GenerateComprehensionCheckRequest,
) -> Result<ComprehensionCheck, ListeningCommandError> {
    let settings = resolve_listening_settings(&app_handle).await?;
    let messages = check_generation_messages(&request);
    let (content, _performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: check_response_schema(),
            temperature: 0.4,
            think: false,
            request_failed_code: "listening-request-failed",
            timeout_message: "The local tutor took too long to prepare a comprehension check.",
            failure_message: "The comprehension check request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredCheck>(&content)
        .map_err(|error| {
            ListeningCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    let path = history::db_path(&app_handle)?;
    let tutor_reply = request.tutor_reply.clone();
    let session_id = request.session_id;
    let stage = request.stage;
    let check_type = parsed.check_type;
    let question = parsed.question.clone();
    let options_json = if parsed.options.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&parsed.options).map_err(|error| {
            ListeningCommandError::new(
                "listening-task-failed",
                "The comprehension check could not be saved.",
                error.to_string(),
            )
        })?)
    };
    let correct_option_index = parsed.correct_option_index;
    let expected_criteria = parsed.expected_criteria.clone();
    let created_at = now_ms();

    let id = tauri::async_runtime::spawn_blocking(move || -> Result<i64, ListeningCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::insert_listening_check(
            &conn,
            session_id,
            &tutor_reply,
            check_type,
            &question,
            options_json.as_deref(),
            correct_option_index,
            expected_criteria.as_deref(),
            stage,
            created_at,
        )?)
    })
    .await
    .map_err(|error| {
        ListeningCommandError::new(
            "listening-task-failed",
            "The comprehension check could not be saved.",
            error.to_string(),
        )
    })??;

    Ok(ComprehensionCheck {
        id,
        check_type: parsed.check_type,
        question: parsed.question,
        options: (!parsed.options.is_empty()).then_some(parsed.options),
    })
}

#[tauri::command]
pub async fn submit_listening_check_attempt(
    app_handle: AppHandle,
    request: SubmitListeningCheckAttemptRequest,
) -> Result<ListeningCheckResult, ListeningCommandError> {
    let path = history::db_path(&app_handle)?;
    let fetch_path = path.clone();
    let check_id = request.check_id;

    let core = tauri::async_runtime::spawn_blocking(
        move || -> Result<history::ListeningCheckCore, ListeningCommandError> {
            let conn = history::open_connection(&fetch_path)?;
            history::listening_check_core(&conn, check_id)?.ok_or_else(|| {
                ListeningCommandError::new(
                    "not-found",
                    "That comprehension check no longer exists.",
                    format!("listening_check {check_id} not found"),
                )
            })
        },
    )
    .await
    .map_err(|error| {
        ListeningCommandError::new(
            "listening-task-failed",
            "The comprehension check could not be loaded.",
            error.to_string(),
        )
    })??;

    let (is_correct, feedback) = match core.check_type {
        ListeningCheckType::SummaryChoice => {
            let correct_index = core.correct_option_index.ok_or_else(|| {
                ListeningCommandError::new(
                    "invalid-response",
                    "The comprehension check is missing its answer key.",
                    "correct_option_index was null for a summary_choice check",
                )
            })?;
            let is_correct = grade_multiple_choice(correct_index, &core.options, &request.answer);
            let feedback = if is_correct {
                "Correct.".to_string()
            } else {
                "Not quite — listen again for that detail.".to_string()
            };
            (is_correct, feedback)
        }
        _ => {
            let settings = resolve_listening_settings(&app_handle).await?;
            let criteria = core.expected_criteria.clone().unwrap_or_default();
            let messages = grade_messages(&core.tutor_reply, &core.question, &criteria, &request.answer);
            let (content, _performance) = tutor::perform_structured_chat(
                &settings,
                tutor::StructuredChatRequest {
                    messages,
                    schema: grade_response_schema(),
                    temperature: 0.2,
                    think: false,
                    request_failed_code: "listening-request-failed",
                    timeout_message: "The local tutor took too long to grade the answer.",
                    failure_message: "The comprehension check grading request could not complete.",
                },
            )
            .await?;
            let parsed = serde_json::from_str::<StructuredGrade>(&content).map_err(|error| {
                ListeningCommandError::new(
                    "invalid-response",
                    "The local tutor returned invalid structured output.",
                    error.to_string(),
                )
            })?;
            (parsed.is_correct, parsed.feedback)
        }
    };

    let created_at = now_ms();
    let answer = request.answer.clone();
    let insert_path = path.clone();
    tauri::async_runtime::spawn_blocking({
        let feedback = feedback.clone();
        move || -> Result<(), ListeningCommandError> {
            let conn = history::open_connection(&insert_path)?;
            history::insert_listening_check_attempt(
                &conn, check_id, &answer, is_correct, &feedback, created_at,
            )?;
            Ok(())
        }
    })
    .await
    .map_err(|error| {
        ListeningCommandError::new(
            "listening-task-failed",
            "The comprehension check attempt could not be saved.",
            error.to_string(),
        )
    })??;

    let listening_profile = learner_profile::adjust_listening_progress(&app_handle, is_correct).await?;

    Ok(ListeningCheckResult {
        is_correct,
        feedback,
        new_stage: listening_profile.stage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grade_multiple_choice_accepts_matching_option_text_case_insensitively() {
        let options = vec!["Paris".to_string(), "London".to_string(), "Rome".to_string()];
        assert!(grade_multiple_choice(1, &options, "london"));
        assert!(grade_multiple_choice(1, &options, "  London  "));
    }

    #[test]
    fn grade_multiple_choice_accepts_matching_index_as_string() {
        let options = vec!["Paris".to_string(), "London".to_string(), "Rome".to_string()];
        assert!(grade_multiple_choice(2, &options, "2"));
    }

    #[test]
    fn grade_multiple_choice_rejects_wrong_option() {
        let options = vec!["Paris".to_string(), "London".to_string(), "Rome".to_string()];
        assert!(!grade_multiple_choice(1, &options, "Paris"));
        assert!(!grade_multiple_choice(1, &options, "0"));
    }

    #[test]
    fn structured_check_validated_rejects_summary_choice_without_three_options() {
        let check = StructuredCheck {
            check_type: ListeningCheckType::SummaryChoice,
            question: "Which is correct?".to_string(),
            options: vec!["a".to_string(), "b".to_string()],
            correct_option_index: Some(0),
            expected_criteria: None,
        };
        assert!(check.validated().is_err());
    }

    #[test]
    fn structured_check_validated_rejects_free_text_without_criteria() {
        let check = StructuredCheck {
            check_type: ListeningCheckType::DetailQuestion,
            question: "What time did they agree to meet?".to_string(),
            options: Vec::new(),
            correct_option_index: None,
            expected_criteria: None,
        };
        assert!(check.validated().is_err());
    }

    #[test]
    fn structured_check_validated_accepts_well_formed_summary_choice() {
        let check = StructuredCheck {
            check_type: ListeningCheckType::SummaryChoice,
            question: "Which summary is accurate?".to_string(),
            options: vec!["a".to_string(), "b".to_string(), "c".to_string()],
            correct_option_index: Some(1),
            expected_criteria: None,
        };
        assert!(check.validated().is_ok());
    }
}
