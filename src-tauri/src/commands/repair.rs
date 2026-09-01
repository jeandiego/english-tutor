use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::assessment::CefrLevel;
use super::chunk::{self, ChunkCandidateInput, ChunkOrigin};
use super::history::{self, HistoryCommandError};
use super::review;
use super::tutor::{
    self, OllamaRequestMessage, TutorCommandError, TutorMessage, TutorMessageRole,
    TutorPerformance,
};

const MAX_HISTORY_MESSAGES: usize = 24;

const REPAIR_DETECTOR_SYSTEM_INSTRUCTION: &str = r#"You are the repair-opportunity evaluator for an English conversation tutor. You do not converse with the learner — you silently review their last utterance (a speech transcript, in the final user message) and decide whether it contains one clear priority error worth flagging.

Choose at most one issue, from exactly these categories: grammar, vocabulary, pronunciation (inferred only from likely transcription artifacts, never actual audio — you never hear the learner), fluency, coherence, pragmatics.

Correct less, but better. Only flag an error if fixing it would meaningfully help the learner: prioritize errors that block communication or that recur in the conversation history you're given. Ignore harmless slips, filler words, and transcription punctuation artifacts. If nothing meaningful stands out, returning shouldIntervene: false is the common, expected, correct outcome — not a failure.

When shouldIntervene is true, always return exactly this JSON object shape, using these exact field names:
{
  "shouldIntervene": true,
  "priority": "grammar | vocabulary | pronunciation | fluency | coherence | pragmatics",
  "issue": "a short label for the issue",
  "original": "the learner's exact flawed wording",
  "suggested": "a corrected version",
  "microExplanation": "one short sentence explaining the fix",
  "repairPrompt": "a short spoken-style request for the learner to try the sentence again"
}

When shouldIntervene is false, return exactly this shape:
{
  "shouldIntervene": false,
  "reason": "a short reason correction would interrupt flow unnecessarily"
}"#;

const REPAIR_OUTCOME_SYSTEM_INSTRUCTION: &str = r#"You are judging whether a learner's new attempt resolves an issue you previously flagged. You do not converse with the learner. You will be given the flagged priority, issue, original wording, and suggested correction, followed by the learner's new attempt as the final user message.

Judge only whether the new attempt fixes the substance of the flagged issue — a correct paraphrase counts as improved, not just an exact match to the suggested wording.

Always return exactly this JSON object shape, using these exact field names:
{
  "shouldIntervene": false,
  "repairOutcome": "improved" | "failed"
}"#;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepairPriority {
    Grammar,
    Vocabulary,
    Pronunciation,
    Fluency,
    Coherence,
    Pragmatics,
}

fn repair_priority_label(priority: RepairPriority) -> &'static str {
    match priority {
        RepairPriority::Grammar => "grammar",
        RepairPriority::Vocabulary => "vocabulary",
        RepairPriority::Pronunciation => "pronunciation",
        RepairPriority::Fluency => "fluency",
        RepairPriority::Coherence => "coherence",
        RepairPriority::Pragmatics => "pragmatics",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepairMode {
    Implicit,
    Quick,
    Repair,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepairIntensity {
    Light,
    Balanced,
    Strict,
}

impl Default for RepairIntensity {
    fn default() -> Self {
        RepairIntensity::Balanced
    }
}

fn repair_intensity_label(intensity: RepairIntensity) -> &'static str {
    match intensity {
        RepairIntensity::Light => "light",
        RepairIntensity::Balanced => "balanced",
        RepairIntensity::Strict => "strict",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepairOutcome {
    Improved,
    Failed,
    Skipped,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepairCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl RepairCommandError {
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

impl From<TutorCommandError> for RepairCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<HistoryCommandError> for RepairCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for RepairCommandError {
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

fn required_text(value: String, field: &str) -> Result<String, RepairCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(RepairCommandError::new(
            "invalid-response",
            "The repair evaluator returned an invalid structured response.",
            format!("The {field} field was empty."),
        ));
    }
    Ok(normalized)
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let normalized = value.trim().to_string();
        (!normalized.is_empty()).then_some(normalized)
    })
}

fn missing_field(field: &str) -> RepairCommandError {
    RepairCommandError::new(
        "invalid-response",
        "The repair evaluator returned an invalid structured response.",
        format!("The {field} field was missing."),
    )
}

// ---------------------------------------------------------------------
// Evaluator (fresh detection, or judging a pending repair attempt)
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingRepairContext {
    priority: RepairPriority,
    issue: String,
    original: String,
    suggested: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluateRepairRequest {
    transcript: String,
    #[serde(default)]
    history: Vec<TutorMessage>,
    #[serde(default)]
    learner_context: Option<String>,
    intensity: RepairIntensity,
    #[serde(default)]
    pending_repair: Option<PendingRepairContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredRepairEvaluation {
    should_intervene: bool,
    #[serde(default)]
    priority: Option<RepairPriority>,
    #[serde(default)]
    issue: Option<String>,
    #[serde(default)]
    original: Option<String>,
    #[serde(default)]
    suggested: Option<String>,
    #[serde(default)]
    micro_explanation: Option<String>,
    #[serde(default)]
    repair_prompt: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    repair_outcome: Option<RepairOutcome>,
}

impl StructuredRepairEvaluation {
    /// `has_pending_repair` switches validation mode: when true, the model's
    /// only job was judging `repairOutcome` against the pending issue — any
    /// `shouldIntervene`/new-issue fields it returns are ignored so a repair
    /// attempt can never chain into a fresh intervention on the same turn.
    fn validated(self, has_pending_repair: bool) -> Result<Self, RepairCommandError> {
        if has_pending_repair {
            let outcome = self.repair_outcome.ok_or_else(|| {
                RepairCommandError::new(
                    "invalid-response",
                    "The repair evaluator returned an invalid structured response.",
                    "repairOutcome was missing while judging a pending repair attempt.",
                )
            })?;
            return Ok(Self {
                should_intervene: false,
                priority: None,
                issue: None,
                original: None,
                suggested: None,
                micro_explanation: None,
                repair_prompt: None,
                reason: None,
                repair_outcome: Some(outcome),
            });
        }

        if !self.should_intervene {
            return Ok(Self {
                should_intervene: false,
                priority: None,
                issue: None,
                original: None,
                suggested: None,
                micro_explanation: None,
                repair_prompt: None,
                reason: normalized_optional(self.reason),
                repair_outcome: None,
            });
        }

        let priority = self.priority.ok_or_else(|| missing_field("priority"))?;
        let issue = required_text(self.issue.unwrap_or_default(), "issue")?;
        let original = required_text(self.original.unwrap_or_default(), "original")?;
        let suggested = required_text(self.suggested.unwrap_or_default(), "suggested")?;
        let micro_explanation =
            required_text(self.micro_explanation.unwrap_or_default(), "microExplanation")?;
        let repair_prompt =
            required_text(self.repair_prompt.unwrap_or_default(), "repairPrompt")?;

        Ok(Self {
            should_intervene: true,
            priority: Some(priority),
            issue: Some(issue),
            original: Some(original),
            suggested: Some(suggested),
            micro_explanation: Some(micro_explanation),
            repair_prompt: Some(repair_prompt),
            reason: None,
            repair_outcome: None,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepairEvaluation {
    should_intervene: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<RepairPriority>,
    #[serde(skip_serializing_if = "Option::is_none")]
    issue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    original: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    micro_explanation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repair_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repair_outcome: Option<RepairOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn repair_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "shouldIntervene": { "type": "boolean" },
            "priority": {
                "type": "string",
                "enum": ["grammar", "vocabulary", "pronunciation", "fluency", "coherence", "pragmatics"]
            },
            "issue": { "type": "string" },
            "original": { "type": "string" },
            "suggested": { "type": "string" },
            "microExplanation": { "type": "string" },
            "repairPrompt": { "type": "string" },
            "reason": { "type": "string" },
            "repairOutcome": {
                "type": "string",
                "enum": ["improved", "failed"]
            }
        },
        "required": ["shouldIntervene"]
    })
}

fn intensity_guidance(intensity: RepairIntensity) -> &'static str {
    match intensity {
        RepairIntensity::Light => {
            "At light intensity, only flag errors that would genuinely confuse a listener — stay quiet on minor slips."
        }
        RepairIntensity::Balanced => {
            "At balanced intensity, flag errors that meaningfully affect clarity or that you see recurring, but still let minor slips pass."
        }
        RepairIntensity::Strict => {
            "At strict intensity, flag most errors worth a learner's attention, including smaller grammar and vocabulary slips."
        }
    }
}

fn repair_messages(request: &EvaluateRepairRequest) -> Vec<OllamaRequestMessage> {
    let mut messages = Vec::new();

    match &request.pending_repair {
        Some(pending) => {
            messages.push(OllamaRequestMessage {
                role: "system",
                content: format!(
                    "{}\n\nFlagged issue:\npriority: {}\nissue: {}\noriginal: \"{}\"\nsuggested: \"{}\"",
                    REPAIR_OUTCOME_SYSTEM_INSTRUCTION,
                    repair_priority_label(pending.priority),
                    pending.issue.trim(),
                    pending.original.trim(),
                    pending.suggested.trim(),
                ),
            });
        }
        None => {
            messages.push(OllamaRequestMessage {
                role: "system",
                content: format!(
                    "{}\n\nIntensity setting: {}. {}",
                    REPAIR_DETECTOR_SYSTEM_INSTRUCTION,
                    repair_intensity_label(request.intensity),
                    intensity_guidance(request.intensity),
                ),
            });
        }
    }

    if let Some(context) = request
        .learner_context
        .as_deref()
        .map(str::trim)
        .filter(|context| !context.is_empty())
    {
        messages.push(OllamaRequestMessage {
            role: "system",
            content: context.to_string(),
        });
    }

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

async fn resolve_repair_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, RepairCommandError> {
    let path = tutor::config_path(app_handle)?;
    let settings = tutor::load_settings(path).await?;
    Ok(settings)
}

#[tauri::command]
pub async fn evaluate_repair_opportunity(
    app_handle: AppHandle,
    request: EvaluateRepairRequest,
) -> Result<RepairEvaluation, RepairCommandError> {
    let settings = resolve_repair_settings(&app_handle).await?;
    let has_pending_repair = request.pending_repair.is_some();
    let messages = repair_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: repair_response_schema(),
            temperature: 0.2,
            think: false,
            request_failed_code: "repair-request-failed",
            timeout_message: "The local tutor took too long to evaluate the turn.",
            failure_message: "The repair evaluation request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredRepairEvaluation>(&content)
        .map_err(|error| {
            RepairCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated(has_pending_repair)?;

    Ok(RepairEvaluation {
        should_intervene: parsed.should_intervene,
        priority: parsed.priority,
        issue: parsed.issue,
        original: parsed.original,
        suggested: parsed.suggested,
        micro_explanation: parsed.micro_explanation,
        repair_prompt: parsed.repair_prompt,
        reason: parsed.reason,
        repair_outcome: parsed.repair_outcome,
        performance,
    })
}

// ---------------------------------------------------------------------
// Repair event persistence
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRepairEventRequest {
    turn_id: i64,
    priority: RepairPriority,
    issue: String,
    original: String,
    suggested: String,
    micro_explanation: String,
    #[serde(default)]
    repair_prompt: Option<String>,
    mode: RepairMode,
    intensity: RepairIntensity,
}

#[tauri::command]
pub async fn record_repair_event(
    app_handle: AppHandle,
    request: RecordRepairEventRequest,
) -> Result<i64, RepairCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<i64, RepairCommandError> {
        let conn = history::open_connection(&path)?;
        let id = history::insert_repair_event(
            &conn,
            request.turn_id,
            request.priority,
            &request.issue,
            &request.original,
            &request.suggested,
            &request.micro_explanation,
            request.repair_prompt.as_deref(),
            request.mode,
            request.intensity,
            now_ms(),
        )?;
        Ok(id)
    })
    .await
    .map_err(|error| {
        RepairCommandError::new(
            "repair-task-failed",
            "The repair event could not be saved.",
            error.to_string(),
        )
    })?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRepairEventOutcomeRequest {
    event_id: i64,
    outcome: RepairOutcome,
}

#[tauri::command]
pub async fn update_repair_event_outcome(
    app_handle: AppHandle,
    request: UpdateRepairEventOutcomeRequest,
) -> Result<(), RepairCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), RepairCommandError> {
        let conn = history::open_connection(&path)?;
        history::update_repair_event_outcome(&conn, request.event_id, request.outcome)?;

        // A repair that the learner still couldn't resolve (`Failed`) is the
        // strongest "worth remembering later" signal this loop produces —
        // `Improved` is already resolved in-session and `Skipped` carries no
        // signal either way, so both are no-ops here.
        if request.outcome == RepairOutcome::Failed {
            if let Some((priority, issue, original, suggested)) =
                history::get_repair_event_core(&conn, request.event_id)?
            {
                if priority == RepairPriority::Pronunciation {
                    history::insert_pronunciation_target(
                        &conn,
                        &suggested,
                        super::pronunciation::PronunciationTargetSource::RepairEvent,
                        Some(request.event_id),
                        None,
                        now_ms(),
                    )?;
                } else if priority == RepairPriority::Vocabulary {
                    // A failed vocabulary repair is already a strong "needs
                    // spaced review" signal, so — unlike other sources — the
                    // resulting chunk is auto-promoted immediately instead of
                    // waiting for the user to promote it manually. If dedup
                    // matched an existing chunk instead, its promotion state
                    // is left as-is (don't force-promote something the user
                    // already decided not to promote).
                    let (chunk_id, created) = history::create_chunk_candidate(
                        &conn,
                        ChunkCandidateInput {
                            chunk_type: chunk::infer_chunk_type(&suggested),
                            text: &suggested,
                            meaning: &issue,
                            register: "neutral",
                            target_level: CefrLevel::C1,
                            domain: None,
                            examples: std::slice::from_ref(&suggested),
                            common_error: Some(&original),
                            origin: ChunkOrigin::RepairEvent,
                            source_correction_id: None,
                            source_expression_id: None,
                            source_repair_event_id: Some(request.event_id),
                            source_writing_evaluation_id: None,
                            source_reading_session_attempt_id: None,
                            source_scenario_pack_id: None,
                        },
                        now_ms(),
                    )?;
                    if created {
                        history::promote_chunk_to_review(&conn, chunk_id, now_ms())?;
                    }
                } else {
                    let item_type = review::review_type_from_repair_priority(priority);
                    let content =
                        review::compose_review_content_from_repair(&issue, &original, &suggested);
                    history::insert_review_item(
                        &conn,
                        item_type,
                        &content,
                        review::ReviewSource::RepairEvent,
                        Some(request.event_id),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        now_ms(),
                    )?;
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|error| {
        RepairCommandError::new(
            "repair-task-failed",
            "The repair event could not be updated.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_request(intensity: RepairIntensity) -> EvaluateRepairRequest {
        EvaluateRepairRequest {
            transcript: "Yesterday I go to the office".to_string(),
            history: vec![
                TutorMessage {
                    role: TutorMessageRole::Assistant,
                    content: "What did you do yesterday?".to_string(),
                },
                TutorMessage {
                    role: TutorMessageRole::User,
                    content: "".to_string(),
                },
            ],
            learner_context: Some("The learner is preparing for job interviews.".to_string()),
            intensity,
            pending_repair: None,
        }
    }

    #[test]
    fn repair_messages_include_intensity_guidance_and_learner_context_and_skip_blank_history() {
        let request = base_request(RepairIntensity::Strict);
        let messages = repair_messages(&request);

        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("strict"));
        assert!(messages[0].content.contains(REPAIR_DETECTOR_SYSTEM_INSTRUCTION));

        assert_eq!(messages[1].role, "system");
        assert!(messages[1].content.contains("job interviews"));

        // The blank history message must be dropped, leaving one prior
        // assistant turn plus the new transcript as the final user message.
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages.last().unwrap().role, "user");
        assert_eq!(messages.last().unwrap().content, "Yesterday I go to the office");
    }

    #[test]
    fn repair_messages_switch_to_outcome_prompt_when_pending_repair_is_present() {
        let mut request = base_request(RepairIntensity::Balanced);
        request.pending_repair = Some(PendingRepairContext {
            priority: RepairPriority::Grammar,
            issue: "past tense form".to_string(),
            original: "Yesterday I go to the office".to_string(),
            suggested: "Yesterday I went to the office".to_string(),
        });

        let messages = repair_messages(&request);
        assert!(messages[0].content.contains(REPAIR_OUTCOME_SYSTEM_INSTRUCTION));
        assert!(messages[0].content.contains("Yesterday I went to the office"));
        assert!(!messages[0].content.contains("Intensity setting"));
    }

    #[test]
    fn validated_requires_all_intervention_fields_when_should_intervene_is_true() {
        let sparse = StructuredRepairEvaluation {
            should_intervene: true,
            priority: Some(RepairPriority::Grammar),
            issue: Some("past tense form".to_string()),
            original: Some("Yesterday I go to the office".to_string()),
            suggested: None,
            micro_explanation: Some("Use past tense.".to_string()),
            repair_prompt: Some("Try that again.".to_string()),
            reason: None,
            repair_outcome: None,
        };
        assert!(sparse.validated(false).is_err());

        let complete = StructuredRepairEvaluation {
            should_intervene: true,
            priority: Some(RepairPriority::Grammar),
            issue: Some("past tense form".to_string()),
            original: Some("Yesterday I go to the office".to_string()),
            suggested: Some("Yesterday I went to the office".to_string()),
            micro_explanation: Some("Use past tense.".to_string()),
            repair_prompt: Some("Try that again.".to_string()),
            reason: None,
            repair_outcome: None,
        };
        let validated = complete.validated(false).expect("complete payload must validate");
        assert!(validated.should_intervene);
        assert_eq!(validated.suggested.as_deref(), Some("Yesterday I went to the office"));
    }

    #[test]
    fn validated_accepts_should_intervene_false_with_only_a_reason() {
        let payload = StructuredRepairEvaluation {
            should_intervene: false,
            priority: None,
            issue: None,
            original: None,
            suggested: None,
            micro_explanation: None,
            repair_prompt: None,
            reason: Some("  The sentence was communicative and correct.  ".to_string()),
            repair_outcome: None,
        };
        let validated = payload.validated(false).expect("clean-turn payload must validate");
        assert!(!validated.should_intervene);
        assert_eq!(
            validated.reason.as_deref(),
            Some("The sentence was communicative and correct.")
        );
    }

    #[test]
    fn validated_ignores_should_intervene_and_requires_repair_outcome_when_pending_repair_present() {
        let payload = StructuredRepairEvaluation {
            should_intervene: true,
            priority: Some(RepairPriority::Vocabulary),
            issue: Some("unrelated new issue".to_string()),
            original: Some("x".to_string()),
            suggested: Some("y".to_string()),
            micro_explanation: Some("z".to_string()),
            repair_prompt: Some("w".to_string()),
            reason: None,
            repair_outcome: Some(RepairOutcome::Improved),
        };
        let validated = payload.validated(true).expect("outcome payload must validate");
        assert!(!validated.should_intervene);
        assert_eq!(validated.priority, None);
        assert_eq!(validated.repair_outcome, Some(RepairOutcome::Improved));

        let missing_outcome = StructuredRepairEvaluation {
            should_intervene: false,
            priority: None,
            issue: None,
            original: None,
            suggested: None,
            micro_explanation: None,
            repair_prompt: None,
            reason: None,
            repair_outcome: None,
        };
        assert!(missing_outcome.validated(true).is_err());
    }
}
