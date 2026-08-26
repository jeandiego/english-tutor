use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{ErrorKind, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const CONFIG_FILE_NAME: &str = "tutor.json";
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";
const TECHNICAL_OUTPUT_LIMIT: usize = 4_096;
#[cfg(not(test))]
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
const PREFLIGHT_TIMEOUT: Duration = Duration::from_millis(250);
const GENERATION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_HISTORY_MESSAGES: usize = 24;
const TUTOR_SYSTEM_INSTRUCTION: &str = r#"You are an engaged English conversation tutor for a learner at approximately B2 level who is working toward C1 conversational ability.

During normal conversation, speak only English. Respond naturally to the learner's meaning as a conversation partner, including professional and software topics. Keep the conversational reply concise enough to be spoken, usually two to four sentences, and ask a useful follow-up question when it helps the conversation. Do not praise every answer and do not turn every response into a lesson.

Return corrections separately and selectively. Focus on errors that meaningfully affect grammar, vocabulary, naturalness, or clarity. Ignore harmless slips and transcription punctuation artifacts. Never claim to have heard pronunciation, tone, stress, or any other audio detail because you receive only transcript text. Return at most 2-3 corrections per turn, choosing only the highest-learning-value items; if the learner's English is already natural, returning zero corrections is correct and expected. Do not over-correct.

Always return exactly this top-level JSON object shape, using these exact field names:
{
  "reply": "A concise natural conversational response.",
  "corrections": [
    {
      "original": "the learner's wording",
      "correction": "a corrected version",
      "explanation": "a short useful reason",
      "category": "grammar | vocabulary | naturalness | clarity",
      "severity": "minor | important"
    }
  ],
  "betterExpressions": [
    {
      "original": "optional original wording",
      "suggestion": "a natural spoken alternative",
      "explanation": "optional short reason"
    }
  ]
}
Use empty arrays when there are no useful corrections or expressions. Never replace these fields with alternatives such as feedback, suggestion, answer, or response. The reply field is only the natural conversational response; correction explanations and better expressions belong only in their respective arrays."#;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TutorSettings {
    base_url: String,
    model_name: String,
    #[serde(default)]
    thinking_enabled: bool,
}

impl Default for TutorSettings {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            model_name: String::new(),
            thinking_enabled: false,
        }
    }
}

impl TutorSettings {
    fn normalized(mut self) -> Self {
        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();
        self.model_name = self.model_name.trim().to_string();
        self
    }
}

#[cfg(test)]
pub(crate) fn test_settings(base_url: String, model_name: &str) -> TutorSettings {
    TutorSettings {
        base_url,
        model_name: model_name.to_string(),
        thinking_enabled: false,
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TutorPreflightStatus {
    OllamaUnavailable,
    NoModelConfigured,
    ConfiguredModelUnavailable,
    Ready,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TutorModel {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parameter_size: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TutorPreflight {
    status: TutorPreflightStatus,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    technical_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    available_models: Vec<TutorModel>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TutorSetup {
    settings: TutorSettings,
    preflight: TutorPreflight,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TutorMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TutorMessage {
    pub(crate) role: TutorMessageRole,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct OllamaRequestMessage {
    pub(crate) role: &'static str,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TutorTurnRequest {
    transcript: String,
    history: Vec<TutorMessage>,
    #[serde(default)]
    session_id: Option<i64>,
    #[serde(default)]
    learner_context: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CorrectionCategory {
    Grammar,
    Vocabulary,
    Naturalness,
    Clarity,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CorrectionSeverity {
    Minor,
    Important,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TutorCorrection {
    pub(crate) original: String,
    pub(crate) correction: String,
    pub(crate) explanation: String,
    pub(crate) category: CorrectionCategory,
    pub(crate) severity: CorrectionSeverity,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BetterExpression {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) original: Option<String>,
    pub(crate) suggestion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) explanation: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredTutorTurn {
    reply: String,
    corrections: Vec<TutorCorrection>,
    better_expressions: Vec<BetterExpression>,
}

impl StructuredTutorTurn {
    fn validated(mut self) -> Result<Self, TutorCommandError> {
        self.reply = required_text(self.reply, "reply")?;

        for (index, correction) in self.corrections.iter_mut().enumerate() {
            correction.original = required_text(
                std::mem::take(&mut correction.original),
                &format!("corrections[{index}].original"),
            )?;
            correction.correction = required_text(
                std::mem::take(&mut correction.correction),
                &format!("corrections[{index}].correction"),
            )?;
            correction.explanation = required_text(
                std::mem::take(&mut correction.explanation),
                &format!("corrections[{index}].explanation"),
            )?;
        }

        for (index, expression) in self.better_expressions.iter_mut().enumerate() {
            expression.suggestion = required_text(
                std::mem::take(&mut expression.suggestion),
                &format!("betterExpressions[{index}].suggestion"),
            )?;
            expression.original = normalized_optional(expression.original.take());
            expression.explanation = normalized_optional(expression.explanation.take());
        }

        Ok(self)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TutorPerformance {
    output_tokens: u64,
    tokens_per_second: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TutorTurn {
    reply: String,
    corrections: Vec<TutorCorrection>,
    better_expressions: Vec<BetterExpression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage_warning: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TutorCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl TutorCommandError {
    fn new(
        code: &'static str,
        message: impl Into<String>,
        technical_message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            technical_message: truncate(&technical_message.into()),
        }
    }

    pub(crate) fn into_parts(self) -> (&'static str, String, String) {
        (self.code, self.message, self.technical_message)
    }
}

#[derive(Debug, Deserialize)]
struct OllamaVersionResponse {
    version: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    remote_model: String,
    #[serde(default)]
    remote_host: String,
    #[serde(default)]
    details: OllamaModelDetails,
}

#[derive(Default, Debug, Deserialize)]
struct OllamaModelDetails {
    #[serde(default)]
    parameter_size: String,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaChatMessage,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    eval_duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaErrorResponse {
    error: String,
}

struct PreflightResult {
    preflight: TutorPreflight,
    canonical_model_name: Option<String>,
}

fn describe_request_error(error: &reqwest::Error) -> String {
    use std::error::Error as _;

    let mut message = error.to_string();
    let mut cause = error.source();
    while let Some(source) = cause {
        message.push_str(&format!(": {source}"));
        cause = source.source();
    }
    message
}

fn truncate(value: &str) -> String {
    if value.chars().count() <= TECHNICAL_OUTPUT_LIMIT {
        return value.to_string();
    }

    let mut truncated = value
        .chars()
        .take(TECHNICAL_OUTPUT_LIMIT)
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn required_text(value: String, field: &str) -> Result<String, TutorCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(TutorCommandError::new(
            "invalid-response",
            "The local tutor returned an invalid structured response.",
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

fn tutor_performance(
    eval_count: Option<u64>,
    eval_duration: Option<u64>,
) -> Option<TutorPerformance> {
    let (Some(output_tokens), Some(eval_duration)) = (eval_count, eval_duration) else {
        return None;
    };
    if output_tokens == 0 || eval_duration == 0 {
        return None;
    }

    let tokens_per_second = output_tokens as f64 * 1_000_000_000.0 / eval_duration as f64;
    tokens_per_second.is_finite().then_some(TutorPerformance {
        output_tokens,
        tokens_per_second,
    })
}

pub(crate) fn config_path(app_handle: &AppHandle) -> Result<PathBuf, TutorCommandError> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|error| {
            TutorCommandError::new(
                "configuration-read-failed",
                "The tutor settings location is unavailable.",
                error.to_string(),
            )
        })
}

fn read_settings(path: &Path) -> Result<TutorSettings, TutorCommandError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(TutorSettings::default()),
        Err(error) => {
            return Err(TutorCommandError::new(
                "configuration-read-failed",
                "The tutor settings could not be read.",
                error.to_string(),
            ))
        }
    };

    serde_json::from_slice::<TutorSettings>(&content)
        .map(TutorSettings::normalized)
        .map_err(|error| {
            TutorCommandError::new(
                "configuration-read-failed",
                "The tutor settings file is invalid.",
                error.to_string(),
            )
        })
}

fn write_settings(path: &Path, settings: &TutorSettings) -> Result<(), TutorCommandError> {
    let directory = path.parent().ok_or_else(|| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings location is invalid.",
            path.display().to_string(),
        )
    })?;

    fs::create_dir_all(directory).map_err(|error| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings directory could not be created.",
            error.to_string(),
        )
    })?;

    let mut temporary = NamedTempFile::new_in(directory).map_err(|error| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings could not be saved.",
            error.to_string(),
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, settings).map_err(|error| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings could not be serialized.",
            error.to_string(),
        )
    })?;
    temporary.flush().map_err(|error| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings could not be saved.",
            error.to_string(),
        )
    })?;
    temporary.persist(path).map_err(|error| {
        TutorCommandError::new(
            "configuration-write-failed",
            "The tutor settings could not be saved.",
            error.error.to_string(),
        )
    })?;

    Ok(())
}

fn is_local_network_address(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_loopback() || address.is_private() || address.is_link_local()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || (address.segments()[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (address.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

fn validate_base_url(value: &str) -> Result<Url, TutorCommandError> {
    let mut url = Url::parse(value).map_err(|error| {
        TutorCommandError::new(
            "invalid-base-url",
            "Enter a valid local Ollama URL.",
            error.to_string(),
        )
    })?;

    if url.scheme() != "http" {
        return Err(TutorCommandError::new(
            "invalid-base-url",
            "Ollama must use a local HTTP URL.",
            format!("Unsupported URL scheme: {}", url.scheme()),
        ));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(TutorCommandError::new(
            "invalid-base-url",
            "The Ollama URL cannot contain credentials.",
            value,
        ));
    }

    if url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err(TutorCommandError::new(
            "invalid-base-url",
            "Use the root URL of the local Ollama service.",
            value,
        ));
    }

    let local_host = match url.host_str() {
        Some(host) if host.eq_ignore_ascii_case("localhost") => true,
        Some(host) => host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .map(|address| is_local_network_address(&address))
            .unwrap_or(false),
        None => false,
    };

    if !local_host {
        return Err(TutorCommandError::new(
            "non-local-base-url",
            "The Ollama URL must be this Mac or a private network address.",
            value,
        ));
    }

    url.set_path("/");
    Ok(url)
}

fn build_client() -> Result<Client, TutorCommandError> {
    Client::builder()
        .connect_timeout(PREFLIGHT_TIMEOUT)
        .timeout(GENERATION_TIMEOUT)
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .map_err(|error| {
            TutorCommandError::new(
                "ollama-unavailable",
                "The local Ollama client could not be initialized.",
                error.to_string(),
            )
        })
}

fn unavailable_preflight(settings: &TutorSettings, error: &TutorCommandError) -> PreflightResult {
    PreflightResult {
        preflight: TutorPreflight {
            status: TutorPreflightStatus::OllamaUnavailable,
            message: format!("Ollama is unavailable at {}.", settings.base_url),
            technical_message: Some(error.technical_message.clone()),
            version: None,
            available_models: Vec::new(),
        },
        canonical_model_name: None,
    }
}

async fn response_text(
    response: reqwest::Response,
    operation: &'static str,
) -> Result<String, TutorCommandError> {
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        TutorCommandError::new(
            operation,
            "Ollama returned an unreadable response.",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        let detail = serde_json::from_str::<OllamaErrorResponse>(&body)
            .map(|response| response.error)
            .unwrap_or_else(|_| body.clone());
        return Err(TutorCommandError::new(
            operation,
            format!("Ollama returned HTTP {status}."),
            detail,
        ));
    }

    Ok(body)
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: Url,
) -> Result<T, TutorCommandError> {
    let response = client
        .get(url)
        .timeout(PREFLIGHT_TIMEOUT)
        .send()
        .await
        .map_err(|error| {
            TutorCommandError::new(
                "ollama-unavailable",
                "The local Ollama service could not be reached.",
                describe_request_error(&error),
            )
        })?;
    let body = response_text(response, "ollama-unavailable").await?;
    serde_json::from_str(&body).map_err(|error| {
        TutorCommandError::new(
            "ollama-unavailable",
            "Ollama returned an invalid status response.",
            error.to_string(),
        )
    })
}

fn has_explicit_tag(model_name: &str) -> bool {
    model_name
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .contains(':')
}

fn model_matches(configured: &str, candidate: &str) -> bool {
    configured == candidate
        || (!has_explicit_tag(configured) && candidate == format!("{configured}:latest"))
}

async fn preflight(settings: &TutorSettings) -> PreflightResult {
    let base_url = match validate_base_url(&settings.base_url) {
        Ok(url) => url,
        Err(error) => return unavailable_preflight(settings, &error),
    };
    let client = match build_client() {
        Ok(client) => client,
        Err(error) => return unavailable_preflight(settings, &error),
    };

    let version = match get_json::<OllamaVersionResponse>(
        &client,
        base_url
            .join("api/version")
            .expect("fixed endpoint must join"),
    )
    .await
    {
        Ok(response) => response.version,
        Err(error) => return unavailable_preflight(settings, &error),
    };
    let tags = match get_json::<OllamaTagsResponse>(
        &client,
        base_url.join("api/tags").expect("fixed endpoint must join"),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => return unavailable_preflight(settings, &error),
    };

    let mut local_models = tags
        .models
        .into_iter()
        .filter(|model| model.remote_host.is_empty() && model.remote_model.is_empty())
        .filter_map(|model| {
            let name = if model.name.is_empty() {
                model.model
            } else {
                model.name
            };
            (!name.is_empty()).then_some(TutorModel {
                name,
                parameter_size: normalized_optional(Some(model.details.parameter_size)),
            })
        })
        .collect::<Vec<_>>();
    local_models.sort_by(|left, right| left.name.cmp(&right.name));

    if settings.model_name.is_empty() {
        return PreflightResult {
            preflight: TutorPreflight {
                status: TutorPreflightStatus::NoModelConfigured,
                message: "Choose a locally installed Ollama model.".to_string(),
                technical_message: None,
                version: Some(version),
                available_models: local_models,
            },
            canonical_model_name: None,
        };
    }

    let canonical_model_name = local_models
        .iter()
        .find(|model| model_matches(&settings.model_name, &model.name))
        .map(|model| model.name.clone());

    match canonical_model_name {
        Some(canonical_model_name) => PreflightResult {
            preflight: TutorPreflight {
                status: TutorPreflightStatus::Ready,
                message: format!("Ollama is ready with {canonical_model_name}."),
                technical_message: None,
                version: Some(version),
                available_models: local_models,
            },
            canonical_model_name: Some(canonical_model_name),
        },
        None => PreflightResult {
            preflight: TutorPreflight {
                status: TutorPreflightStatus::ConfiguredModelUnavailable,
                message: format!(
                    "The configured model {} is not installed locally.",
                    settings.model_name
                ),
                technical_message: None,
                version: Some(version),
                available_models: local_models,
            },
            canonical_model_name: None,
        },
    }
}

fn response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "reply": { "type": "string", "minLength": 1 },
            "corrections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "original": { "type": "string", "minLength": 1 },
                        "correction": { "type": "string", "minLength": 1 },
                        "explanation": { "type": "string", "minLength": 1 },
                        "category": {
                            "type": "string",
                            "enum": ["grammar", "vocabulary", "naturalness", "clarity"]
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["minor", "important"]
                        }
                    },
                    "required": ["original", "correction", "explanation", "category", "severity"]
                }
            },
            "betterExpressions": {
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
            }
        },
        "required": ["reply", "corrections", "betterExpressions"]
    })
}

fn request_messages(
    request: TutorTurnRequest,
) -> Result<Vec<OllamaRequestMessage>, TutorCommandError> {
    let transcript = required_text(request.transcript, "transcript")?;
    let history_start = request.history.len().saturating_sub(MAX_HISTORY_MESSAGES);
    let mut messages = Vec::with_capacity(request.history.len() - history_start + 3);
    messages.push(OllamaRequestMessage {
        role: "system",
        content: TUTOR_SYSTEM_INSTRUCTION.to_string(),
    });

    if let Some(learner_context) = request.learner_context {
        let learner_context = learner_context.trim().to_string();
        if !learner_context.is_empty() {
            messages.push(OllamaRequestMessage {
                role: "system",
                content: learner_context,
            });
        }
    }

    for mut message in request.history.into_iter().skip(history_start) {
        message.content = message.content.trim().to_string();
        if !message.content.is_empty() {
            messages.push(OllamaRequestMessage {
                role: match message.role {
                    TutorMessageRole::User => "user",
                    TutorMessageRole::Assistant => "assistant",
                },
                content: message.content,
            });
        }
    }
    messages.push(OllamaRequestMessage {
        role: "user",
        content: transcript,
    });
    Ok(messages)
}

fn command_error_for_preflight(preflight: &TutorPreflight) -> TutorCommandError {
    let code = match preflight.status {
        TutorPreflightStatus::OllamaUnavailable => "ollama-unavailable",
        TutorPreflightStatus::NoModelConfigured => "model-not-configured",
        TutorPreflightStatus::ConfiguredModelUnavailable => "model-unavailable",
        TutorPreflightStatus::Ready => "ollama-unavailable",
    };
    TutorCommandError::new(
        code,
        &preflight.message,
        preflight
            .technical_message
            .as_deref()
            .unwrap_or(&preflight.message),
    )
}

/// Parameters for one Ollama `/api/chat` request with a structured-output
/// schema. `request_failed_code`/`timeout_message`/`failure_message` let
/// each caller (the tutor's conversational turns, the assessment engine's
/// follow-up/evaluator/summary calls) report a caller-appropriate error
/// code and user-facing message while sharing the same preflight/HTTP path.
pub(crate) struct StructuredChatRequest {
    pub(crate) messages: Vec<OllamaRequestMessage>,
    pub(crate) schema: Value,
    pub(crate) temperature: f64,
    pub(crate) think: bool,
    pub(crate) request_failed_code: &'static str,
    pub(crate) timeout_message: &'static str,
    pub(crate) failure_message: &'static str,
}

/// Runs one Ollama `/api/chat` request with a structured-output schema and
/// returns the model's raw JSON content string plus performance metrics.
/// Each caller parses+validates the content against its own structured
/// type; preflight, base-URL, and client setup are identical for all of
/// them.
pub(crate) async fn perform_structured_chat(
    settings: &TutorSettings,
    request: StructuredChatRequest,
) -> Result<(String, Option<TutorPerformance>), TutorCommandError> {
    let readiness = preflight(settings).await;
    if readiness.preflight.status != TutorPreflightStatus::Ready {
        return Err(command_error_for_preflight(&readiness.preflight));
    }
    let model_name = readiness
        .canonical_model_name
        .expect("ready preflight must have a canonical model name");
    let base_url = validate_base_url(&settings.base_url)?;
    let client = build_client()?;
    let body = json!({
        "model": model_name,
        "messages": request.messages,
        "stream": false,
        "think": request.think,
        "format": request.schema,
        "options": { "temperature": request.temperature }
    });

    let response = client
        .post(base_url.join("api/chat").expect("fixed endpoint must join"))
        .timeout(GENERATION_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            let message = if error.is_timeout() {
                request.timeout_message
            } else {
                request.failure_message
            };
            TutorCommandError::new(
                request.request_failed_code,
                message,
                describe_request_error(&error),
            )
        })?;
    let response_body = response_text(response, request.request_failed_code).await?;
    let response = serde_json::from_str::<OllamaChatResponse>(&response_body).map_err(|error| {
        TutorCommandError::new(
            "invalid-response",
            "Ollama returned an invalid chat response.",
            error.to_string(),
        )
    })?;
    let performance = tutor_performance(response.eval_count, response.eval_duration);
    Ok((response.message.content, performance))
}

async fn generate(
    settings: &TutorSettings,
    request: TutorTurnRequest,
) -> Result<TutorTurn, TutorCommandError> {
    let messages = request_messages(request)?;
    let think = settings.thinking_enabled;
    let (content, performance) = perform_structured_chat(
        settings,
        StructuredChatRequest {
            messages,
            schema: response_schema(),
            temperature: 0.3,
            think,
            request_failed_code: "tutor-request-failed",
            timeout_message: "The local tutor took too long to respond.",
            failure_message: "The local tutor request could not complete.",
        },
    )
    .await?;
    let turn = serde_json::from_str::<StructuredTutorTurn>(&content)
        .map_err(|error| {
            TutorCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    Ok(TutorTurn {
        reply: turn.reply,
        corrections: turn.corrections,
        better_expressions: turn.better_expressions,
        performance,
        storage_warning: None,
    })
}

pub(crate) async fn load_settings(path: PathBuf) -> Result<TutorSettings, TutorCommandError> {
    tauri::async_runtime::spawn_blocking(move || read_settings(&path))
        .await
        .map_err(|error| {
            TutorCommandError::new(
                "configuration-read-failed",
                "The tutor settings check could not complete.",
                error.to_string(),
            )
        })?
}

#[tauri::command]
pub async fn load_tutor_setup(app_handle: AppHandle) -> Result<TutorSetup, TutorCommandError> {
    let settings = load_settings(config_path(&app_handle)?).await?;
    let readiness = preflight(&settings).await;
    Ok(TutorSetup {
        settings,
        preflight: readiness.preflight,
    })
}

#[tauri::command]
pub async fn save_tutor_settings(
    app_handle: AppHandle,
    settings: TutorSettings,
) -> Result<TutorSetup, TutorCommandError> {
    let path = config_path(&app_handle)?;
    let settings = settings.normalized();
    let saved_settings = settings.clone();
    tauri::async_runtime::spawn_blocking(move || write_settings(&path, &saved_settings))
        .await
        .map_err(|error| {
            TutorCommandError::new(
                "configuration-write-failed",
                "The tutor settings check could not complete.",
                error.to_string(),
            )
        })??;
    let readiness = preflight(&settings).await;
    Ok(TutorSetup {
        settings,
        preflight: readiness.preflight,
    })
}

#[tauri::command]
pub async fn generate_tutor_turn(
    app_handle: AppHandle,
    request: TutorTurnRequest,
) -> Result<TutorTurn, TutorCommandError> {
    let settings = load_settings(config_path(&app_handle)?).await?;
    let session_id = request.session_id;
    let transcript = request.transcript.clone();
    let mut turn = generate(&settings, request).await?;

    if let Some(session_id) = session_id {
        if let Err(error) = super::history::persist_turn(
            &app_handle,
            session_id,
            transcript,
            turn.reply.clone(),
            turn.corrections.clone(),
            turn.better_expressions.clone(),
        )
        .await
        {
            turn.storage_warning = Some(error.message().to_string());
        }
    }

    Ok(turn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::mpsc::{self, Receiver},
        thread::{self, JoinHandle},
    };
    use tempfile::TempDir;

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
        let address = listener
            .local_addr()
            .expect("listener address must resolve");
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
                    {
                        "name": "qwen3.5:9b",
                        "model": "qwen3.5:9b",
                        "details": { "parameter_size": "9B" }
                    },
                    {
                        "name": "cloud-model:latest",
                        "remote_model": "cloud-model",
                        "remote_host": "https://ollama.com",
                        "details": { "parameter_size": "70B" }
                    }
                ]
            })
            .to_string(),
        }
    }

    fn settings(base_url: String, model_name: &str) -> TutorSettings {
        TutorSettings {
            base_url,
            model_name: model_name.to_string(),
            thinking_enabled: false,
        }
    }

    #[test]
    fn settings_default_round_trip_and_url_validation() {
        let directory = TempDir::new().expect("tempdir must exist");
        let path = directory.path().join("nested/tutor.json");
        let defaults = read_settings(&directory.path().join("missing.json"))
            .expect("missing settings must use defaults");
        assert_eq!(defaults.base_url, DEFAULT_BASE_URL);
        assert!(defaults.model_name.is_empty());

        let normalized = TutorSettings {
            base_url: "  http://localhost:11434/  ".into(),
            model_name: "  qwen3.5:9b  ".into(),
            thinking_enabled: true,
        }
        .normalized();
        write_settings(&path, &normalized).expect("settings must write");
        assert_eq!(
            read_settings(&path).expect("settings must read"),
            normalized
        );

        assert!(validate_base_url("http://localhost:11434").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_base_url("http://[::1]:11434").is_ok());
        assert!(validate_base_url("http://192.168.1.4:11434").is_ok());
        assert!(validate_base_url("http://10.0.0.5:11434").is_ok());
        assert!(validate_base_url("http://172.16.0.5:11434").is_ok());
        assert_eq!(
            validate_base_url("http://8.8.8.8:11434")
                .expect_err("public address must fail")
                .code,
            "non-local-base-url"
        );
        assert!(validate_base_url("https://localhost:11434").is_err());
        assert!(validate_base_url("http://localhost:11434/api").is_err());
        assert!(validate_base_url("http://user@localhost:11434").is_err());
    }

    #[test]
    fn preflight_distinguishes_all_runtime_states_and_filters_remote_models() {
        tauri::async_runtime::block_on(async {
            let unavailable = preflight(&settings("https://example.com".into(), "")).await;
            assert_eq!(
                unavailable.preflight.status,
                TutorPreflightStatus::OllamaUnavailable
            );

            let (base_url, _, server) = mock_ollama(vec![version_fixture(), tags_fixture()]);
            let no_model = preflight(&settings(base_url, "")).await;
            server.join().expect("server must finish");
            assert_eq!(
                no_model.preflight.status,
                TutorPreflightStatus::NoModelConfigured
            );
            assert_eq!(no_model.preflight.available_models.len(), 1);
            assert_eq!(no_model.preflight.available_models[0].name, "qwen3.5:9b");

            let (base_url, _, server) = mock_ollama(vec![version_fixture(), tags_fixture()]);
            let missing = preflight(&settings(base_url, "missing:latest")).await;
            server.join().expect("server must finish");
            assert_eq!(
                missing.preflight.status,
                TutorPreflightStatus::ConfiguredModelUnavailable
            );

            let (base_url, _, server) = mock_ollama(vec![version_fixture(), tags_fixture()]);
            let ready = preflight(&settings(base_url, "qwen3.5:9b")).await;
            server.join().expect("server must finish");
            assert_eq!(ready.preflight.status, TutorPreflightStatus::Ready);
            assert_eq!(ready.canonical_model_name.as_deref(), Some("qwen3.5:9b"));
            assert!(model_matches("llama3.2", "llama3.2:latest"));
        });
    }

    #[test]
    fn generation_sends_bounded_context_schema_and_parses_typed_response() {
        tauri::async_runtime::block_on(async {
            let structured_turn = json!({
                "reply": "  Backend work can broaden your perspective. What are you learning?  ",
                "corrections": [{
                    "original": "since many years",
                    "correction": "for many years",
                    "explanation": "Use for with a duration.",
                    "category": "grammar",
                    "severity": "important"
                }],
                "betterExpressions": []
            });
            let chat_fixture = ResponseFixture {
                path: "/api/chat",
                status: 200,
                body: json!({
                    "message": {
                        "role": "assistant",
                        "content": structured_turn.to_string()
                    },
                    "eval_count": 104,
                    "eval_duration": 3_780_934_000_u64
                })
                .to_string(),
            };
            let (base_url, requests, server) =
                mock_ollama(vec![version_fixture(), tags_fixture(), chat_fixture]);
            let history = (0..30)
                .map(|index| TutorMessage {
                    role: if index % 2 == 0 {
                        TutorMessageRole::User
                    } else {
                        TutorMessageRole::Assistant
                    },
                    content: format!("history-{index}"),
                })
                .collect();
            let result = generate(
                &settings(base_url, "qwen3.5:9b"),
                TutorTurnRequest {
                    transcript: "I am learning more backend.".into(),
                    history,
                    session_id: None,
                    learner_context: None,
                },
            )
            .await
            .expect("generation must succeed");
            assert_eq!(
                result.reply,
                "Backend work can broaden your perspective. What are you learning?"
            );
            assert_eq!(result.corrections.len(), 1);
            let performance = result.performance.expect("metrics must be exposed");
            assert_eq!(performance.output_tokens, 104);
            assert!((performance.tokens_per_second - 27.506).abs() < 0.001);

            let _version_request = requests.recv().expect("version request must exist");
            let _tags_request = requests.recv().expect("tags request must exist");
            let chat_request = requests.recv().expect("chat request must exist");
            server.join().expect("server must finish");
            let body = chat_request
                .split_once("\r\n\r\n")
                .expect("request body must exist")
                .1;
            let body: Value = serde_json::from_str(body).expect("body must be json");
            assert_eq!(body["model"], "qwen3.5:9b");
            assert_eq!(body["stream"], false);
            assert_eq!(body["think"], false);
            assert_eq!(body["format"]["type"], "object");
            assert_eq!(body["messages"].as_array().expect("messages").len(), 26);
            assert_eq!(body["messages"][0]["role"], "system");
            assert_eq!(body["messages"][1]["content"], "history-6");
            assert_eq!(
                body["messages"][25]["content"],
                "I am learning more backend."
            );
        });
    }

    #[test]
    fn generation_forwards_thinking_enabled_flag() {
        tauri::async_runtime::block_on(async {
            let structured_turn = json!({
                "reply": "Sounds good.",
                "corrections": [],
                "betterExpressions": []
            });
            let chat_fixture = ResponseFixture {
                path: "/api/chat",
                status: 200,
                body: json!({
                    "message": {
                        "role": "assistant",
                        "content": structured_turn.to_string()
                    }
                })
                .to_string(),
            };
            let (base_url, requests, server) =
                mock_ollama(vec![version_fixture(), tags_fixture(), chat_fixture]);
            let mut request_settings = settings(base_url, "qwen3.5:9b");
            request_settings.thinking_enabled = true;
            generate(
                &request_settings,
                TutorTurnRequest {
                    transcript: "Hello".into(),
                    history: Vec::new(),
                    session_id: None,
                    learner_context: None,
                },
            )
            .await
            .expect("generation must succeed");

            let _version_request = requests.recv().expect("version request must exist");
            let _tags_request = requests.recv().expect("tags request must exist");
            let chat_request = requests.recv().expect("chat request must exist");
            server.join().expect("server must finish");
            let body = chat_request
                .split_once("\r\n\r\n")
                .expect("request body must exist")
                .1;
            let body: Value = serde_json::from_str(body).expect("body must be json");
            assert_eq!(body["think"], true);
        });
    }

    #[test]
    fn request_messages_includes_learner_context_only_when_present() {
        let without_context = request_messages(TutorTurnRequest {
            transcript: "Hello".into(),
            history: Vec::new(),
            session_id: None,
            learner_context: None,
        })
        .expect("messages must build");
        assert_eq!(without_context.len(), 2);
        assert_eq!(without_context[0].role, "system");
        assert_eq!(without_context[0].content, TUTOR_SYSTEM_INSTRUCTION);
        assert_eq!(without_context[1].role, "user");

        let with_blank_context = request_messages(TutorTurnRequest {
            transcript: "Hello".into(),
            history: Vec::new(),
            session_id: None,
            learner_context: Some("   ".into()),
        })
        .expect("messages must build");
        assert_eq!(with_blank_context.len(), 2);

        let with_context = request_messages(TutorTurnRequest {
            transcript: "Hello".into(),
            history: Vec::new(),
            session_id: Some(1),
            learner_context: Some(
                "The learner has recently repeated mistakes involving grammar.".into(),
            ),
        })
        .expect("messages must build");
        assert_eq!(with_context.len(), 3);
        assert_eq!(with_context[1].role, "system");
        assert!(with_context[1].content.contains("grammar"));
        assert_eq!(with_context[2].role, "user");
    }

    #[test]
    fn structured_validation_rejects_unknown_fields_enums_and_empty_required_text() {
        let extra_field = json!({
            "reply": "Hello",
            "corrections": [],
            "betterExpressions": [],
            "score": 99
        });
        assert!(serde_json::from_value::<StructuredTutorTurn>(extra_field).is_err());

        let invalid_enum = json!({
            "reply": "Hello",
            "corrections": [{
                "original": "x",
                "correction": "y",
                "explanation": "z",
                "category": "pronunciation",
                "severity": "important"
            }],
            "betterExpressions": []
        });
        assert!(serde_json::from_value::<StructuredTutorTurn>(invalid_enum).is_err());

        let empty = StructuredTutorTurn {
            reply: "   ".into(),
            corrections: Vec::new(),
            better_expressions: Vec::new(),
        };
        assert_eq!(
            empty.validated().expect_err("empty reply must fail").code,
            "invalid-response"
        );
    }

    #[test]
    fn generation_metrics_are_optional_and_require_positive_values() {
        assert_eq!(tutor_performance(None, None), None);
        assert_eq!(tutor_performance(Some(12), None), None);
        assert_eq!(tutor_performance(Some(0), Some(1_000_000_000)), None);
        assert_eq!(tutor_performance(Some(12), Some(0)), None);
    }

    #[test]
    fn generation_surfaces_ollama_error_body() {
        tauri::async_runtime::block_on(async {
            let (base_url, _, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                ResponseFixture {
                    path: "/api/chat",
                    status: 500,
                    body: json!({ "error": "model runner crashed" }).to_string(),
                },
            ]);
            let error = generate(
                &settings(base_url, "qwen3.5:9b"),
                TutorTurnRequest {
                    transcript: "Hello".into(),
                    history: Vec::new(),
                    session_id: None,
                    learner_context: None,
                },
            )
            .await
            .expect_err("server failure must surface");
            server.join().expect("server must finish");
            assert_eq!(error.code, "tutor-request-failed");
            assert_eq!(error.technical_message, "model runner crashed");
        });
    }

    #[test]
    fn preflight_timeout_is_reported_as_unavailable() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener must bind");
        let address = listener
            .local_addr()
            .expect("listener address must resolve");
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().expect("request must connect");
            thread::sleep(Duration::from_millis(400));
        });

        let result = tauri::async_runtime::block_on(preflight(&settings(
            format!("http://{address}"),
            "qwen3.5:9b",
        )));
        server.join().expect("server must finish");
        assert_eq!(
            result.preflight.status,
            TutorPreflightStatus::OllamaUnavailable
        );
        assert!(!result
            .preflight
            .technical_message
            .expect("technical message")
            .is_empty());
    }
}
