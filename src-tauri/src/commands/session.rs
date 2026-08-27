use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::repair::{RepairMode, RepairOutcome, RepairPriority};
use super::tutor::{
    self, BetterExpression, OllamaRequestMessage, TutorCommandError, TutorCorrection,
    TutorMessage, TutorMessageRole, TutorPerformance,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairEventSummary {
    priority: RepairPriority,
    issue: String,
    mode: RepairMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    outcome: Option<RepairOutcome>,
}

const OPENING_SYSTEM_INSTRUCTION: &str = r#"You are an English conversation tutor opening a guided practice session with a specific scenario. You will be given scenario instructions describing the setting, your role, and the learner's goal, plus optional context about the learner.

Produce one natural, spoken-style opening (1 to 3 sentences) that steps into the scenario immediately — greet the learner in character, set the scene briefly, and end with something that invites them to respond, such as a question. Do not explain that this is a practice session, and do not mention CEFR levels, assessment, or the learner profile explicitly. Speak only English.

Always return exactly this JSON object shape, using this exact field name:
{
  "opening": "the spoken opening line"
}"#;

const SESSION_SUMMARY_SYSTEM_INSTRUCTION: &str = r#"You are writing the closing summary for a guided English conversation practice session. You do not converse with the learner — a separate component already ran the conversation. Your only job is to summarize it constructively and specifically, grounded in what was actually said.

You will be given the scenario label, the full turn-by-turn transcript, and every correction and better-expression suggestion that came up naturally during the conversation.

Write:
- whatWentWell: concrete things the learner communicated well, grounded in the transcript. Never generic praise.
- priorityIssues: the 1 to 3 most important problems to work on next, chosen from the corrections and transcript. Never more than 3 entries, and never empty — if nothing significant stood out, include one concrete fluency-building suggestion instead.
- alternativePhrases: natural, more idiomatic ways to phrase things the learner said, drawn from the better-expression suggestions and the transcript.
- reviewItems: short, concrete items worth reviewing later, such as a grammar point, a vocabulary item, or a phrase.

Never write empty motivational filler. Ground every item in the actual conversation.

Always return exactly this JSON object shape, using these exact field names:
{
  "whatWentWell": ["..."],
  "priorityIssues": ["..."],
  "alternativePhrases": [{ "original": "optional original wording", "suggestion": "a natural alternative", "explanation": "optional short reason" }],
  "reviewItems": ["..."]
}"#;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl SessionCommandError {
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

impl From<TutorCommandError> for SessionCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

fn required_text(value: String, field: &str) -> Result<String, SessionCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(SessionCommandError::new(
            "invalid-response",
            "The session model returned an invalid structured response.",
            format!("The {field} field was empty."),
        ));
    }

    Ok(normalized)
}

async fn resolve_session_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, SessionCommandError> {
    let path = tutor::config_path(app_handle)?;
    let settings = tutor::load_settings(path).await?;
    Ok(settings)
}

// ---------------------------------------------------------------------
// Session opener
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenSessionRequest {
    scenario_system_prompt: String,
    #[serde(default)]
    learner_context: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredOpening {
    opening: String,
}

impl StructuredOpening {
    fn validated(self) -> Result<Self, SessionCommandError> {
        Ok(Self {
            opening: required_text(self.opening, "opening")?,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpeningTurn {
    opening: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn opening_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "opening": { "type": "string", "minLength": 1 }
        },
        "required": ["opening"]
    })
}

fn opening_messages(request: &OpenSessionRequest) -> Vec<OllamaRequestMessage> {
    let mut messages = vec![
        OllamaRequestMessage {
            role: "system",
            content: OPENING_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "system",
            content: format!(
                "Scenario instructions: {}",
                request.scenario_system_prompt.trim()
            ),
        },
    ];

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

    messages.push(OllamaRequestMessage {
        role: "user",
        content: "Begin the session now.".to_string(),
    });
    messages
}

#[tauri::command]
pub async fn open_guided_session(
    app_handle: AppHandle,
    request: OpenSessionRequest,
) -> Result<OpeningTurn, SessionCommandError> {
    let settings = resolve_session_settings(&app_handle).await?;
    let messages = opening_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: opening_response_schema(),
            temperature: 0.5,
            think: false,
            request_failed_code: "session-request-failed",
            timeout_message: "The local tutor took too long to open the session.",
            failure_message: "The session opener request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredOpening>(&content)
        .map_err(|error| {
            SessionCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    Ok(OpeningTurn {
        opening: parsed.opening,
        performance,
    })
}

// ---------------------------------------------------------------------
// Session summary synthesis
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynthesizeSessionSummaryRequest {
    scenario_label: String,
    turns: Vec<TutorMessage>,
    #[serde(default)]
    corrections: Vec<TutorCorrection>,
    #[serde(default)]
    better_expressions: Vec<BetterExpression>,
    #[serde(default)]
    repair_events: Vec<RepairEventSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredSessionSummary {
    what_went_well: Vec<String>,
    priority_issues: Vec<String>,
    alternative_phrases: Vec<BetterExpression>,
    review_items: Vec<String>,
}

impl StructuredSessionSummary {
    fn validated(mut self) -> Result<Self, SessionCommandError> {
        if self.priority_issues.is_empty() {
            return Err(SessionCommandError::new(
                "invalid-response",
                "The session summary did not identify any priorities.",
                "priorityIssues was empty",
            ));
        }
        if self.priority_issues.len() > 3 {
            return Err(SessionCommandError::new(
                "invalid-response",
                "The session summary returned too many priorities.",
                format!("priorityIssues had {} entries", self.priority_issues.len()),
            ));
        }

        for (index, item) in self.what_went_well.iter_mut().enumerate() {
            *item = required_text(std::mem::take(item), &format!("whatWentWell[{index}]"))?;
        }
        for (index, item) in self.priority_issues.iter_mut().enumerate() {
            *item = required_text(std::mem::take(item), &format!("priorityIssues[{index}]"))?;
        }
        for (index, phrase) in self.alternative_phrases.iter_mut().enumerate() {
            phrase.suggestion = required_text(
                std::mem::take(&mut phrase.suggestion),
                &format!("alternativePhrases[{index}].suggestion"),
            )?;
        }
        for (index, item) in self.review_items.iter_mut().enumerate() {
            *item = required_text(std::mem::take(item), &format!("reviewItems[{index}]"))?;
        }

        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryPayload {
    pub(crate) what_went_well: Vec<String>,
    pub(crate) priority_issues: Vec<String>,
    pub(crate) alternative_phrases: Vec<BetterExpression>,
    pub(crate) review_items: Vec<String>,
    #[serde(default)]
    pub(crate) repair_events: Vec<RepairEventSummary>,
}

impl SessionSummaryPayload {
    fn from_structured(value: StructuredSessionSummary, repair_events: Vec<RepairEventSummary>) -> Self {
        Self {
            what_went_well: value.what_went_well,
            priority_issues: value.priority_issues,
            alternative_phrases: value.alternative_phrases,
            review_items: value.review_items,
            repair_events,
        }
    }
}

fn summary_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "whatWentWell": {
                "type": "array",
                "items": { "type": "string" }
            },
            "priorityIssues": {
                "type": "array",
                "items": { "type": "string" },
                "minItems": 1,
                "maxItems": 3
            },
            "alternativePhrases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "original": { "type": "string" },
                        "suggestion": { "type": "string", "minLength": 1 },
                        "explanation": { "type": "string" }
                    },
                    "required": ["suggestion"]
                }
            },
            "reviewItems": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["whatWentWell", "priorityIssues", "alternativePhrases", "reviewItems"]
    })
}

fn format_transcript(turns: &[TutorMessage]) -> String {
    if turns.is_empty() {
        return "(no turns recorded)".to_string();
    }
    turns
        .iter()
        .map(|message| {
            let speaker = match message.role {
                TutorMessageRole::User => "Learner",
                TutorMessageRole::Assistant => "Tutor",
            };
            format!("{speaker}: {}", message.content)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_corrections(corrections: &[TutorCorrection]) -> String {
    if corrections.is_empty() {
        return "(none noted)".to_string();
    }
    corrections
        .iter()
        .map(|correction| {
            format!(
                "- \"{}\" -> \"{}\" ({})",
                correction.original, correction.correction, correction.explanation
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_better_expressions(expressions: &[BetterExpression]) -> String {
    if expressions.is_empty() {
        return "(none noted)".to_string();
    }
    expressions
        .iter()
        .map(|expression| match &expression.original {
            Some(original) => format!("- \"{original}\" -> \"{}\"", expression.suggestion),
            None => format!("- \"{}\"", expression.suggestion),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn summary_messages(request: &SynthesizeSessionSummaryRequest) -> Vec<OllamaRequestMessage> {
    let user_content = format!(
        "Scenario: {}\n\nTranscript:\n{}\n\nCorrections noted during the conversation:\n{}\n\nBetter-expression suggestions noted during the conversation:\n{}",
        request.scenario_label.trim(),
        format_transcript(&request.turns),
        format_corrections(&request.corrections),
        format_better_expressions(&request.better_expressions),
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: SESSION_SUMMARY_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

#[tauri::command]
pub async fn synthesize_session_summary(
    app_handle: AppHandle,
    request: SynthesizeSessionSummaryRequest,
) -> Result<SessionSummaryPayload, SessionCommandError> {
    let settings = resolve_session_settings(&app_handle).await?;
    let messages = summary_messages(&request);
    let (content, _performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: summary_response_schema(),
            temperature: 0.4,
            think: false,
            request_failed_code: "session-request-failed",
            timeout_message: "The local tutor took too long to summarize the session.",
            failure_message: "The session summary request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredSessionSummary>(&content)
        .map_err(|error| {
            SessionCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    // repair_events are echoed back from what the caller already observed
    // during the session, not authored by the summary LLM call — same
    // principle as the learner model's recurring issues being computed,
    // never guessed.
    Ok(SessionSummaryPayload::from_structured(
        parsed,
        request.repair_events,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tutor::test_settings;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
        time::Duration,
    };

    struct ResponseFixture {
        path: &'static str,
        status: u16,
        body: String,
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("read timeout must set");
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2_048];
        let mut expected_length = None;

        loop {
            let count = stream.read(&mut buffer).expect("request must read");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);

            if expected_length.is_none() {
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    expected_length = Some(header_end + 4 + content_length);
                }
            }

            if expected_length.is_some_and(|length| bytes.len() >= length) {
                break;
            }
        }

        String::from_utf8(bytes).expect("request must be utf8")
    }

    fn mock_ollama(
        fixtures: Vec<ResponseFixture>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener must bind");
        let address = listener
            .local_addr()
            .expect("listener address must resolve");
        let handle = thread::spawn(move || {
            for fixture in fixtures {
                let (mut stream, _) = listener.accept().expect("request must connect");
                let request = read_request(&mut stream);
                assert!(
                    request.starts_with(&format!("GET {} ", fixture.path))
                        || request.starts_with(&format!("POST {} ", fixture.path)),
                    "unexpected request: {request}"
                );
                let reason = if fixture.status == 200 {
                    "OK"
                } else {
                    "Internal Server Error"
                };
                write!(
                    stream,
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    fixture.status,
                    reason,
                    fixture.body.len(),
                    fixture.body
                )
                .expect("response must write");
            }
        });

        (format!("http://{address}"), handle)
    }

    fn version_fixture() -> ResponseFixture {
        ResponseFixture {
            path: "/api/version",
            status: 200,
            body: json!({ "version": "0.20.4" }).to_string(),
        }
    }

    fn tags_fixture() -> ResponseFixture {
        ResponseFixture {
            path: "/api/tags",
            status: 200,
            body: json!({
                "models": [{ "name": "qwen3.5:9b", "model": "qwen3.5:9b", "details": { "parameter_size": "9B" } }]
            })
            .to_string(),
        }
    }

    #[test]
    fn opening_messages_include_scenario_and_optional_learner_context() {
        let without_context = opening_messages(&OpenSessionRequest {
            scenario_system_prompt: "Play the role of a barista.".into(),
            learner_context: None,
        });
        assert_eq!(without_context.len(), 3);
        assert!(without_context[1].content.contains("barista"));

        let with_context = opening_messages(&OpenSessionRequest {
            scenario_system_prompt: "Play the role of a barista.".into(),
            learner_context: Some("The learner recently struggled with past tense.".into()),
        });
        assert_eq!(with_context.len(), 4);
        assert!(with_context[2].content.contains("past tense"));
    }

    #[test]
    fn open_guided_session_parses_and_validates_opening() {
        tauri::async_runtime::block_on(async {
            let chat_fixture = ResponseFixture {
                path: "/api/chat",
                status: 200,
                body: json!({
                    "message": {
                        "role": "assistant",
                        "content": json!({ "opening": "  Good morning! What did you work on yesterday?  " }).to_string()
                    }
                })
                .to_string(),
            };
            let (base_url, server) =
                mock_ollama(vec![version_fixture(), tags_fixture(), chat_fixture]);
            let settings = test_settings(base_url, "qwen3.5:9b");
            let messages = opening_messages(&OpenSessionRequest {
                scenario_system_prompt: "Daily standup.".into(),
                learner_context: None,
            });
            let (content, _performance) = tutor::perform_structured_chat(
                &settings,
                tutor::StructuredChatRequest {
                    messages,
                    schema: opening_response_schema(),
                    temperature: 0.5,
                    think: false,
                    request_failed_code: "session-request-failed",
                    timeout_message: "timeout",
                    failure_message: "failure",
                },
            )
            .await
            .expect("chat must succeed");
            server.join().expect("server must finish");

            let parsed = serde_json::from_str::<StructuredOpening>(&content)
                .expect("content must parse")
                .validated()
                .expect("opening must validate");
            assert_eq!(parsed.opening, "Good morning! What did you work on yesterday?");
        });
    }

    #[test]
    fn structured_summary_rejects_empty_or_excess_priorities() {
        let empty = StructuredSessionSummary {
            what_went_well: vec!["Used natural greetings.".into()],
            priority_issues: vec![],
            alternative_phrases: vec![],
            review_items: vec![],
        };
        assert_eq!(
            empty.validated().expect_err("empty priorities must fail").code,
            "invalid-response"
        );

        let excess = StructuredSessionSummary {
            what_went_well: vec![],
            priority_issues: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            alternative_phrases: vec![],
            review_items: vec![],
        };
        assert_eq!(
            excess.validated().expect_err("excess priorities must fail").code,
            "invalid-response"
        );
    }

    #[test]
    fn structured_summary_trims_and_converts_into_payload() {
        let summary = StructuredSessionSummary {
            what_went_well: vec!["  Gave a clear update.  ".into()],
            priority_issues: vec!["  past tense accuracy  ".into()],
            alternative_phrases: vec![BetterExpression {
                original: Some("I am agree".into()),
                suggestion: "  I agree.  ".into(),
                explanation: None,
            }],
            review_items: vec!["  past tense forms  ".into()],
        }
        .validated()
        .expect("summary must validate");

        let repair_events = vec![RepairEventSummary {
            priority: RepairPriority::Grammar,
            issue: "past tense form".to_string(),
            mode: RepairMode::Repair,
            outcome: Some(RepairOutcome::Improved),
        }];
        let payload = SessionSummaryPayload::from_structured(summary, repair_events.clone());
        assert_eq!(payload.what_went_well, vec!["Gave a clear update.".to_string()]);
        assert_eq!(payload.priority_issues, vec!["past tense accuracy".to_string()]);
        assert_eq!(payload.alternative_phrases[0].suggestion, "I agree.");
        assert_eq!(payload.review_items, vec!["past tense forms".to_string()]);
        assert_eq!(payload.repair_events, repair_events);
    }

    #[test]
    fn format_helpers_report_placeholders_when_empty() {
        assert_eq!(format_transcript(&[]), "(no turns recorded)");
        assert_eq!(format_corrections(&[]), "(none noted)");
        assert_eq!(format_better_expressions(&[]), "(none noted)");
    }
}
