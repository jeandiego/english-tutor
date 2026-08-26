use super::{
    play_audio_file, truncate, TtsAvailability, TtsCommandError, TtsProviderId, TtsProviderInfo,
    TtsSettings, TtsVoice,
};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::json;
use std::{env, io::Write, time::Duration};
use tempfile::NamedTempFile;

const API_KEY_ENV: &str = "ENGLISHER_ELEVENLABS_API_KEY";
const API_BASE_URL: &str = "https://api.elevenlabs.io/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_MODEL_ID: &str = "eleven_multilingual_v2";

fn api_key() -> Option<String> {
    env::var(API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_client() -> Result<Client, TtsCommandError> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| {
            TtsCommandError::new(
                "elevenlabs-unavailable",
                "The ElevenLabs client could not be initialized.",
                error.to_string(),
            )
        })
}

#[derive(Debug, Deserialize)]
struct VoicesResponse {
    #[serde(default)]
    voices: Vec<VoiceEntry>,
}

#[derive(Debug, Deserialize)]
struct VoiceEntry {
    voice_id: String,
    name: String,
    #[serde(default)]
    labels: Option<VoiceLabels>,
}

#[derive(Debug, Deserialize, Default)]
struct VoiceLabels {
    #[serde(default)]
    accent: Option<String>,
}

async fn fetch_voices(client: &Client, key: &str) -> Result<Vec<TtsVoice>, TtsCommandError> {
    let response = client
        .get(format!("{API_BASE_URL}/voices"))
        .header("xi-api-key", key)
        .send()
        .await
        .map_err(|error| {
            TtsCommandError::new(
                "elevenlabs-unavailable",
                "ElevenLabs could not be reached.",
                error.to_string(),
            )
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-unavailable",
            "ElevenLabs returned an unreadable response.",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        return Err(TtsCommandError::new(
            "elevenlabs-unavailable",
            "ElevenLabs rejected the configured API key.",
            format!("HTTP {status}: {}", truncate(&body)),
        ));
    }

    let parsed = serde_json::from_str::<VoicesResponse>(&body).map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-unavailable",
            "ElevenLabs returned an invalid voices response.",
            error.to_string(),
        )
    })?;

    Ok(parsed
        .voices
        .into_iter()
        .map(|voice| TtsVoice {
            id: voice.voice_id,
            label: voice.name,
            locale: voice.labels.and_then(|labels| labels.accent),
        })
        .collect())
}

pub(super) async fn provider_info() -> TtsProviderInfo {
    let base = TtsProviderInfo {
        id: TtsProviderId::ElevenLabs,
        label: TtsProviderId::ElevenLabs.label().to_string(),
        availability: TtsAvailability {
            available: false,
            message: format!("Set {API_KEY_ENV} to enable ElevenLabs."),
            technical_message: None,
        },
        voices: Vec::new(),
        supports_rate: false,
        supports_volume: true,
    };

    let Some(key) = api_key() else {
        return base;
    };

    let client = match build_client() {
        Ok(client) => client,
        Err(error) => {
            return TtsProviderInfo {
                availability: TtsAvailability {
                    available: false,
                    message: "ElevenLabs is unavailable.".to_string(),
                    technical_message: Some(error.technical_message),
                },
                ..base
            }
        }
    };

    match fetch_voices(&client, &key).await {
        Ok(voices) => TtsProviderInfo {
            availability: TtsAvailability {
                available: true,
                message: "ElevenLabs is ready.".to_string(),
                technical_message: None,
            },
            voices,
            ..base
        },
        Err(error) => TtsProviderInfo {
            availability: TtsAvailability {
                available: false,
                message: "ElevenLabs is unavailable.".to_string(),
                technical_message: Some(error.technical_message),
            },
            ..base
        },
    }
}

pub(super) async fn speak(
    afplay_executable: &str,
    settings: &TtsSettings,
    reply: &str,
) -> Result<(), TtsCommandError> {
    let key = api_key().ok_or_else(|| {
        TtsCommandError::new(
            "elevenlabs-unavailable",
            "ElevenLabs is not configured.",
            format!("{API_KEY_ENV} is not set."),
        )
    })?;

    let voice_id = settings.voice_id.trim();
    if voice_id.is_empty() {
        return Err(TtsCommandError::new(
            "elevenlabs-unavailable",
            "No ElevenLabs voice is selected.",
            "TtsSettings.voice_id was empty for the elevenlabs provider.",
        ));
    }

    let client = build_client()?;
    let body = json!({
        "text": reply,
        "model_id": DEFAULT_MODEL_ID,
    });

    let response = client
        .post(format!("{API_BASE_URL}/text-to-speech/{voice_id}"))
        .header("xi-api-key", &key)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            TtsCommandError::new(
                "elevenlabs-failed",
                "ElevenLabs could not synthesize the reply.",
                error.to_string(),
            )
        })?;

    let status = response.status();
    if status != StatusCode::OK {
        let detail = response.text().await.unwrap_or_default();
        return Err(TtsCommandError::new(
            "elevenlabs-failed",
            "ElevenLabs could not synthesize the reply.",
            format!("HTTP {status}: {}", truncate(&detail)),
        ));
    }

    let audio = response.bytes().await.map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-failed",
            "ElevenLabs returned an unreadable audio response.",
            error.to_string(),
        )
    })?;

    let mut file = NamedTempFile::with_suffix(".mp3").map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-failed",
            "The synthesized audio could not be saved.",
            error.to_string(),
        )
    })?;
    file.write_all(&audio).map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-failed",
            "The synthesized audio could not be saved.",
            error.to_string(),
        )
    })?;
    file.flush().map_err(|error| {
        TtsCommandError::new(
            "elevenlabs-failed",
            "The synthesized audio could not be saved.",
            error.to_string(),
        )
    })?;

    play_audio_file(
        afplay_executable.to_string(),
        file.path().to_path_buf(),
        settings.volume,
    )
    .await
}
