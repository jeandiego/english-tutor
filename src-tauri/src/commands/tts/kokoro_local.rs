use super::{TtsAvailability, TtsCommandError, TtsProviderId, TtsProviderInfo, TtsSettings};
use std::{env, path::Path};

const BINARY_ENV: &str = "ENGLISHER_KOKORO_BINARY";

fn configured_binary() -> Option<String> {
    env::var(BINARY_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) async fn provider_info() -> TtsProviderInfo {
    let binary = configured_binary();
    let available = binary
        .as_deref()
        .map(|path| Path::new(path).is_file())
        .unwrap_or(false);

    TtsProviderInfo {
        id: TtsProviderId::KokoroLocal,
        label: TtsProviderId::KokoroLocal.label().to_string(),
        availability: TtsAvailability {
            available,
            message: if available {
                "Kokoro local model is ready.".to_string()
            } else {
                format!("Set {BINARY_ENV} to a local Kokoro binary to enable it.")
            },
            technical_message: None,
        },
        voices: Vec::new(),
        supports_rate: false,
        supports_volume: true,
    }
}

pub(super) async fn speak(_settings: &TtsSettings, _reply: &str) -> Result<(), TtsCommandError> {
    Err(TtsCommandError::new(
        "kokoro-unavailable",
        "Kokoro local speech is not available yet.",
        format!("{BINARY_ENV} is not configured or does not point to a file."),
    ))
}
