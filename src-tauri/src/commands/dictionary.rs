use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::chunk::{LexicalChunk, LexicalChunkType};
use super::history::{self, HistoryCommandError};
use super::tutor::{self, OllamaRequestMessage, TutorCommandError};

// ---------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DictionaryContextTag {
    Reading,
    Writing,
    Conversation,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub(crate) id: i64,
    pub(crate) chunk_type: LexicalChunkType,
    pub(crate) text: String,
    pub(crate) meaning: String,
    pub(crate) examples: Vec<String>,
    pub(crate) context_tag: DictionaryContextTag,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_session_id: Option<i64>,
    pub(crate) excluded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) promoted_lexical_chunk_id: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) last_looked_up_at: i64,
}

// ---------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplainSelectionRequest {
    text: String,
    surrounding_context: String,
    context_tag: DictionaryContextTag,
    #[serde(default)]
    session_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetDictionaryEntryExcludedRequest {
    id: i64,
    excluded: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteDictionaryEntryRequest {
    id: i64,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl DictionaryCommandError {
    fn new(code: &'static str, message: impl Into<String>, technical_message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: technical_message.into(),
        }
    }
}

impl From<HistoryCommandError> for DictionaryCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for DictionaryCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

impl From<TutorCommandError> for DictionaryCommandError {
    fn from(error: TutorCommandError) -> Self {
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

fn required_text(value: String, field: &str) -> Result<String, DictionaryCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(DictionaryCommandError::new(
            "invalid-response",
            "The dictionary model returned invalid structured output.",
            format!("The {field} field was empty."),
        ));
    }
    Ok(normalized)
}

// ---------------------------------------------------------------------
// Ollama explanation call — reuses tutor.rs's structured-chat plumbing
// wholesale (preflight, base-URL validation, timeout/error handling);
// only the prompt and schema are new.
// ---------------------------------------------------------------------

const DICTIONARY_SYSTEM_INSTRUCTION: &str = "You are a monolingual English dictionary assistant embedded in an \
English-learning app. Given a word or phrase the learner selected, plus the sentence it appeared in, return ONLY \
an English-language explanation — never translate into another language. Keep the meaning concise (one or two \
sentences) and pitched at an upper-intermediate to advanced learner. Provide 1 to 3 short example sentences \
showing natural usage — they do not need to reuse the original sentence. Classify the selection as exactly one \
of: single_word, collocation, phrase, discourse_marker, hedging_expression, stance_phrase, \
register_specific_expression, domain_specific_expression. If the surrounding sentence disambiguates a \
multi-meaning word, explain the sense that fits that context.";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredExplanation {
    meaning: String,
    examples: Vec<String>,
    chunk_type: LexicalChunkType,
}

impl StructuredExplanation {
    fn validated(mut self) -> Result<Self, DictionaryCommandError> {
        self.meaning = required_text(self.meaning, "meaning")?;
        self.examples.retain(|example| !example.trim().is_empty());
        if self.examples.is_empty() {
            return Err(DictionaryCommandError::new(
                "invalid-response",
                "The dictionary model returned invalid structured output.",
                "The examples field was empty.",
            ));
        }
        Ok(self)
    }
}

fn explanation_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "meaning": { "type": "string", "minLength": 1 },
            "examples": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": { "type": "string", "minLength": 1 }
            },
            "chunkType": {
                "type": "string",
                "enum": [
                    "single_word", "collocation", "phrase", "discourse_marker",
                    "hedging_expression", "stance_phrase", "register_specific_expression",
                    "domain_specific_expression"
                ]
            }
        },
        "required": ["meaning", "examples", "chunkType"]
    })
}

fn explanation_messages(text: &str, surrounding_context: &str) -> Vec<OllamaRequestMessage> {
    let user_content = if surrounding_context.is_empty() {
        format!("Selected text: {text}")
    } else {
        format!("Selected text: {text}\nSentence: {surrounding_context}")
    };
    vec![
        OllamaRequestMessage {
            role: "system",
            content: DICTIONARY_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

async fn generate_explanation(
    settings: &tutor::TutorSettings,
    text: &str,
    surrounding_context: &str,
) -> Result<StructuredExplanation, DictionaryCommandError> {
    let messages = explanation_messages(text, surrounding_context);
    let (content, _performance) = tutor::perform_structured_chat(
        settings,
        tutor::StructuredChatRequest {
            messages,
            schema: explanation_schema(),
            temperature: 0.2,
            think: false,
            request_failed_code: "dictionary-request-failed",
            timeout_message: "The local tutor took too long to explain this.",
            failure_message: "The dictionary explanation request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredExplanation>(&content).map_err(|error| {
        DictionaryCommandError::new(
            "invalid-response",
            "The dictionary model returned invalid structured output.",
            error.to_string(),
        )
    })?;
    parsed.validated()
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn explain_selection(
    app_handle: AppHandle,
    request: ExplainSelectionRequest,
) -> Result<DictionaryEntry, DictionaryCommandError> {
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err(DictionaryCommandError::new(
            "invalid-selection",
            "Select some text before asking for an explanation.",
            "explain_selection called with empty text",
        ));
    }

    let settings_path = tutor::config_path(&app_handle)?;
    let settings = tutor::load_settings(settings_path).await?;
    let explanation = generate_explanation(&settings, &text, request.surrounding_context.trim()).await?;

    let db_path = history::db_path(&app_handle)?;
    let context_tag = request.context_tag;
    let session_id = request.session_id;
    let now = now_ms();
    tauri::async_runtime::spawn_blocking(move || -> Result<DictionaryEntry, DictionaryCommandError> {
        let conn = history::open_connection(&db_path)?;
        let entry_id = history::upsert_dictionary_entry(
            &conn,
            explanation.chunk_type,
            &text,
            &explanation.meaning,
            &explanation.examples,
            context_tag,
            session_id,
            now,
        )?;
        history::dictionary_entry_by_id(&conn, entry_id)?.ok_or_else(|| {
            DictionaryCommandError::new(
                "dictionary-task-failed",
                "The explanation could not be saved.",
                format!("dictionary_entry {entry_id} not found after upsert"),
            )
        })
    })
    .await
    .map_err(|error| {
        DictionaryCommandError::new(
            "dictionary-task-failed",
            "The explanation could not be saved.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn list_dictionary_entries(
    app_handle: AppHandle,
    context_tag: Option<DictionaryContextTag>,
    include_excluded: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<DictionaryEntry>, DictionaryCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(200).clamp(1, 500) as i64;
    let include_excluded = include_excluded.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<DictionaryEntry>, DictionaryCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::list_dictionary_entries(&conn, context_tag, include_excluded, limit)?)
    })
    .await
    .map_err(|error| {
        DictionaryCommandError::new(
            "dictionary-task-failed",
            "The dictionary could not be loaded.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn set_dictionary_entry_excluded(
    app_handle: AppHandle,
    request: SetDictionaryEntryExcludedRequest,
) -> Result<DictionaryEntry, DictionaryCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<DictionaryEntry, DictionaryCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::set_dictionary_entry_excluded(&conn, request.id, request.excluded)?)
    })
    .await
    .map_err(|error| {
        DictionaryCommandError::new(
            "dictionary-task-failed",
            "The dictionary entry could not be updated.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn promote_dictionary_entry(
    app_handle: AppHandle,
    request: PromoteDictionaryEntryRequest,
) -> Result<LexicalChunk, DictionaryCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<LexicalChunk, DictionaryCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::promote_dictionary_entry_to_chunk(&conn, request.id, now_ms())?)
    })
    .await
    .map_err(|error| {
        DictionaryCommandError::new(
            "dictionary-task-failed",
            "The word could not be promoted to practice.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::mpsc::{self, Receiver},
        thread::{self, JoinHandle},
        time::Duration,
    };

    #[test]
    fn structured_explanation_validated_rejects_blank_meaning() {
        let result = StructuredExplanation {
            meaning: "   ".to_string(),
            examples: vec!["Example.".to_string()],
            chunk_type: LexicalChunkType::SingleWord,
        }
        .validated();
        assert!(result.is_err());
    }

    #[test]
    fn structured_explanation_validated_rejects_all_blank_examples() {
        let result = StructuredExplanation {
            meaning: "A concise meaning.".to_string(),
            examples: vec!["  ".to_string(), "".to_string()],
            chunk_type: LexicalChunkType::Phrase,
        }
        .validated();
        assert!(result.is_err());
    }

    #[test]
    fn structured_explanation_validated_trims_meaning_and_drops_blank_examples() {
        let result = StructuredExplanation {
            meaning: "  a concise meaning  ".to_string(),
            examples: vec!["  ".to_string(), "A real example.".to_string()],
            chunk_type: LexicalChunkType::Phrase,
        }
        .validated()
        .expect("validation must succeed");
        assert_eq!(result.meaning, "a concise meaning");
        assert_eq!(result.examples, vec!["A real example.".to_string()]);
    }

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

    fn mock_ollama(fixtures: Vec<ResponseFixture>) -> (String, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener must bind");
        let address = listener.local_addr().expect("listener address must resolve");
        let (sender, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            for fixture in fixtures {
                let (mut stream, _) = listener.accept().expect("request must connect");
                let request = read_request(&mut stream);
                assert!(
                    request.starts_with(&format!("GET {} ", fixture.path))
                        || request.starts_with(&format!("POST {} ", fixture.path)),
                    "unexpected request: {request}"
                );
                let _ = sender.send(request);
                let reason = if fixture.status == 200 { "OK" } else { "Internal Server Error" };
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

        (format!("http://{address}"), receiver, handle)
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
                "models": [
                    { "name": "qwen3.5:9b", "model": "qwen3.5:9b", "details": { "parameter_size": "9B" } }
                ]
            })
            .to_string(),
        }
    }

    fn chat_fixture(status: u16, content: &str) -> ResponseFixture {
        ResponseFixture {
            path: "/api/chat",
            status,
            body: json!({
                "message": { "content": content },
                "eval_count": 42,
                "eval_duration": 1_000_000_000_u64
            })
            .to_string(),
        }
    }

    fn settings(base_url: String) -> tutor::TutorSettings {
        tutor::test_settings(base_url, "qwen3.5:9b")
    }

    #[test]
    fn generate_explanation_happy_path_parses_structured_output() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "meaning": "To postpone something until later.",
                        "examples": ["Let's table this discussion for now."],
                        "chunkType": "phrase"
                    })
                    .to_string(),
                ),
            ]);

            let result = generate_explanation(&settings(base_url), "table this", "Let's table this for now.")
                .await
                .expect("explanation must succeed");
            server.join().expect("server must finish");

            assert_eq!(result.meaning, "To postpone something until later.");
            assert_eq!(result.chunk_type, LexicalChunkType::Phrase);
            assert_eq!(result.examples.len(), 1);
        });
    }

    #[test]
    fn generate_explanation_rejects_invalid_structured_output() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(200, &json!({ "meaning": "", "examples": [], "chunkType": "phrase" }).to_string()),
            ]);

            let result = generate_explanation(&settings(base_url), "table this", "Let's table this for now.").await;
            server.join().expect("server must finish");

            assert!(result.is_err());
        });
    }
}
