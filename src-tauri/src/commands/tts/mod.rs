mod elevenlabs;
mod kokoro_local;
mod macos_say;

use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const CONFIG_FILE_NAME: &str = "tts.json";
const TECHNICAL_OUTPUT_LIMIT: usize = 4_096;
const DEFAULT_AFPLAY_EXECUTABLE: &str = "afplay";
const AFPLAY_EXECUTABLE_ENV: &str = "ENGLISHER_AFPLAY_EXECUTABLE";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TtsProviderId {
    MacosSay,
    KokoroLocal,
    ElevenLabs,
}

impl TtsProviderId {
    fn label(self) -> &'static str {
        match self {
            TtsProviderId::MacosSay => "macOS Speech",
            TtsProviderId::KokoroLocal => "Kokoro (local)",
            TtsProviderId::ElevenLabs => "ElevenLabs",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettings {
    provider: TtsProviderId,
    voice_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rate: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    volume: Option<f32>,
    #[serde(default)]
    kokoro_executable_path: String,
    #[serde(default)]
    kokoro_model_path: String,
    #[serde(default)]
    kokoro_voices_path: String,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            provider: TtsProviderId::MacosSay,
            voice_id: String::new(),
            rate: None,
            volume: None,
            kokoro_executable_path: String::new(),
            kokoro_model_path: String::new(),
            kokoro_voices_path: String::new(),
        }
    }
}

impl TtsSettings {
    fn normalized(mut self) -> Self {
        self.voice_id = self.voice_id.trim().to_string();
        self.rate = self.rate.filter(|value| value.is_finite() && *value > 0.0);
        self.volume = self
            .volume
            .map(|value| value.clamp(0.0, 1.0))
            .filter(|value| value.is_finite());
        self.kokoro_executable_path = self.kokoro_executable_path.trim().to_string();
        self.kokoro_model_path = self.kokoro_model_path.trim().to_string();
        self.kokoro_voices_path = self.kokoro_voices_path.trim().to_string();
        self
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    id: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsAvailability {
    available: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    technical_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsProviderInfo {
    id: TtsProviderId,
    label: String,
    availability: TtsAvailability,
    voices: Vec<TtsVoice>,
    supports_rate: bool,
    supports_volume: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsSetup {
    settings: TtsSettings,
    providers: Vec<TtsProviderInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    reply: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TtsCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl TtsCommandError {
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

fn output_details(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    truncate(
        format!(
            "exit status: {}\nstdout:\n{}\nstderr:\n{}",
            output.status,
            stdout.trim(),
            stderr.trim()
        )
        .trim(),
    )
}

fn afplay_executable() -> String {
    env::var(AFPLAY_EXECUTABLE_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_AFPLAY_EXECUTABLE.to_string())
}

fn run_playback(
    executable: impl AsRef<OsStr>,
    path: &Path,
    volume: Option<f32>,
) -> Result<(), TtsCommandError> {
    let mut command = Command::new(executable);
    if let Some(volume) = volume {
        command.arg("-v").arg(format!("{volume}"));
    }
    command.arg(path);

    let output = command.output().map_err(|error| {
        TtsCommandError::new(
            "speech-unavailable",
            "Audio playback could not be started.",
            error.to_string(),
        )
    })?;

    if !output.status.success() {
        return Err(TtsCommandError::new(
            "speech-failed",
            "Audio playback failed.",
            output_details(&output),
        ));
    }

    Ok(())
}

async fn play_audio_file(
    executable: String,
    path: PathBuf,
    volume: Option<f32>,
) -> Result<(), TtsCommandError> {
    tauri::async_runtime::spawn_blocking(move || run_playback(executable, &path, volume))
        .await
        .map_err(|error| {
            TtsCommandError::new(
                "speech-failed",
                "The audio playback task could not complete.",
                error.to_string(),
            )
        })?
}

async fn dispatch_speech(
    say_executable: String,
    afplay_executable: String,
    settings: &TtsSettings,
    reply: &str,
) -> Result<(), TtsCommandError> {
    if settings.provider == TtsProviderId::MacosSay {
        return macos_say::speak(&say_executable, &afplay_executable, settings, reply).await;
    }

    let attempt = match settings.provider {
        TtsProviderId::ElevenLabs => elevenlabs::speak(&afplay_executable, settings, reply).await,
        TtsProviderId::KokoroLocal => kokoro_local::speak(settings, reply).await,
        TtsProviderId::MacosSay => unreachable!("macos_say is handled above"),
    };

    if attempt.is_ok() {
        return Ok(());
    }

    macos_say::speak(
        &say_executable,
        &afplay_executable,
        &TtsSettings::default(),
        reply,
    )
    .await
}

fn config_path(app_handle: &AppHandle) -> Result<PathBuf, TtsCommandError> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|error| {
            TtsCommandError::new(
                "configuration-read-failed",
                "The voice settings location is unavailable.",
                error.to_string(),
            )
        })
}

fn read_settings(path: &Path) -> Result<TtsSettings, TtsCommandError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(TtsSettings::default()),
        Err(error) => {
            return Err(TtsCommandError::new(
                "configuration-read-failed",
                "The voice settings could not be read.",
                error.to_string(),
            ))
        }
    };

    serde_json::from_slice::<TtsSettings>(&content)
        .map(TtsSettings::normalized)
        .map_err(|error| {
            TtsCommandError::new(
                "configuration-read-failed",
                "The voice settings file is invalid.",
                error.to_string(),
            )
        })
}

fn write_settings(path: &Path, settings: &TtsSettings) -> Result<(), TtsCommandError> {
    let directory = path.parent().ok_or_else(|| {
        TtsCommandError::new(
            "configuration-write-failed",
            "The voice settings location is invalid.",
            path.display().to_string(),
        )
    })?;

    fs::create_dir_all(directory).map_err(|error| {
        TtsCommandError::new(
            "configuration-write-failed",
            "The voice settings directory could not be created.",
            error.to_string(),
        )
    })?;

    let mut temporary = NamedTempFile::new_in(directory).map_err(|error| {
        TtsCommandError::new(
            "configuration-write-failed",
            "The voice settings could not be saved.",
            error.to_string(),
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, settings).map_err(|error| {
        TtsCommandError::new(
            "configuration-write-failed",
            "The voice settings could not be serialized.",
            error.to_string(),
        )
    })?;
    {
        use std::io::Write;
        temporary.flush().map_err(|error| {
            TtsCommandError::new(
                "configuration-write-failed",
                "The voice settings could not be saved.",
                error.to_string(),
            )
        })?;
    }
    temporary.persist(path).map_err(|error| {
        TtsCommandError::new(
            "configuration-write-failed",
            "The voice settings could not be saved.",
            error.error.to_string(),
        )
    })?;

    Ok(())
}

async fn load_settings(path: PathBuf) -> Result<TtsSettings, TtsCommandError> {
    tauri::async_runtime::spawn_blocking(move || read_settings(&path))
        .await
        .map_err(|error| {
            TtsCommandError::new(
                "configuration-read-failed",
                "The voice settings check could not complete.",
                error.to_string(),
            )
        })?
}

async fn build_setup(settings: TtsSettings) -> TtsSetup {
    let providers = vec![
        macos_say::provider_info().await,
        kokoro_local::provider_info(&settings).await,
        elevenlabs::provider_info().await,
    ];
    TtsSetup {
        settings,
        providers,
    }
}

#[tauri::command]
pub async fn load_tts_setup(app_handle: AppHandle) -> Result<TtsSetup, TtsCommandError> {
    let settings = load_settings(config_path(&app_handle)?).await?;
    Ok(build_setup(settings).await)
}

#[tauri::command]
pub async fn save_tts_settings(
    app_handle: AppHandle,
    settings: TtsSettings,
) -> Result<TtsSetup, TtsCommandError> {
    let path = config_path(&app_handle)?;
    let settings = settings.normalized();
    let saved_settings = settings.clone();
    tauri::async_runtime::spawn_blocking(move || write_settings(&path, &saved_settings))
        .await
        .map_err(|error| {
            TtsCommandError::new(
                "configuration-write-failed",
                "The voice settings check could not complete.",
                error.to_string(),
            )
        })??;
    Ok(build_setup(settings).await)
}

#[tauri::command]
pub async fn speak_tutor_reply(
    app_handle: AppHandle,
    request: SpeechRequest,
) -> Result<(), TtsCommandError> {
    let reply = request.reply.trim().to_string();
    if reply.is_empty() {
        return Err(TtsCommandError::new(
            "invalid-speech",
            "The tutor reply was empty, so it could not be spoken.",
            "speak_tutor_reply received an empty reply.",
        ));
    }

    let settings = load_settings(config_path(&app_handle)?)
        .await
        .unwrap_or_default();

    dispatch_speech(
        macos_say::say_executable(),
        afplay_executable(),
        &settings,
        &reply,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};
    use tempfile::TempDir;

    fn executable(directory: &Path, name: &str, script: &str) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).expect("script must write");
        let mut permissions = fs::metadata(&path)
            .expect("script metadata must exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("script must be executable");
        path
    }

    fn settings(provider: TtsProviderId) -> TtsSettings {
        TtsSettings {
            provider,
            voice_id: String::new(),
            rate: None,
            volume: None,
            kokoro_executable_path: String::new(),
            kokoro_model_path: String::new(),
            kokoro_voices_path: String::new(),
        }
    }

    #[test]
    fn settings_default_round_trip() {
        let directory = TempDir::new().expect("tempdir must exist");
        let path = directory.path().join("nested/tts.json");
        let defaults = read_settings(&directory.path().join("missing.json"))
            .expect("missing settings must use defaults");
        assert_eq!(defaults.provider, TtsProviderId::MacosSay);
        assert!(defaults.voice_id.is_empty());

        let normalized = TtsSettings {
            provider: TtsProviderId::ElevenLabs,
            voice_id: "  Rachel  ".into(),
            rate: Some(-5.0),
            volume: Some(2.0),
            kokoro_executable_path: "  /path/to/koko  ".into(),
            kokoro_model_path: "  /path/to/kokoro-v1.0.onnx  ".into(),
            kokoro_voices_path: "  /path/to/voices-v1.0.bin  ".into(),
        }
        .normalized();
        assert_eq!(normalized.voice_id, "Rachel");
        assert_eq!(normalized.rate, None);
        assert_eq!(normalized.volume, Some(1.0));
        assert_eq!(normalized.kokoro_executable_path, "/path/to/koko");
        assert_eq!(
            normalized.kokoro_model_path,
            "/path/to/kokoro-v1.0.onnx"
        );
        assert_eq!(
            normalized.kokoro_voices_path,
            "/path/to/voices-v1.0.bin"
        );

        write_settings(&path, &normalized).expect("settings must write");
        assert_eq!(
            read_settings(&path).expect("settings must read"),
            normalized
        );
    }

    #[test]
    fn dispatch_speaks_directly_when_macos_say_is_active() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(directory.path(), "say-ok", "exit 0");
        let afplay = executable(directory.path(), "afplay-ok", "exit 0");

        tauri::async_runtime::block_on(dispatch_speech(
            say.to_string_lossy().into_owned(),
            afplay.to_string_lossy().into_owned(),
            &settings(TtsProviderId::MacosSay),
            "Hello there.",
        ))
        .expect("macos_say must succeed");
    }

    #[test]
    fn dispatch_falls_back_to_macos_say_when_active_provider_fails() {
        let directory = TempDir::new().expect("tempdir must exist");
        let marker = directory.path().join("say-invoked");
        let say = executable(
            directory.path(),
            "say-marks-invocation",
            &format!("touch {}\nexit 0", marker.display()),
        );
        let afplay = executable(directory.path(), "afplay-ok", "exit 0");

        tauri::async_runtime::block_on(dispatch_speech(
            say.to_string_lossy().into_owned(),
            afplay.to_string_lossy().into_owned(),
            &settings(TtsProviderId::KokoroLocal),
            "Fallback should still speak this.",
        ))
        .expect("fallback to macos_say must succeed");

        assert!(
            marker.exists(),
            "macos_say fallback must run when the active provider fails"
        );
    }

    #[test]
    fn dispatch_surfaces_error_when_macos_say_fallback_also_fails() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-fails",
            "echo 'voice unavailable' >&2\nexit 42",
        );
        let afplay = executable(directory.path(), "afplay-ok", "exit 0");

        let error = tauri::async_runtime::block_on(dispatch_speech(
            say.to_string_lossy().into_owned(),
            afplay.to_string_lossy().into_owned(),
            &settings(TtsProviderId::KokoroLocal),
            "Please speak this.",
        ))
        .expect_err("failure of both provider and fallback must surface");

        assert_eq!(error.code, "speech-failed");
    }

    #[test]
    fn playback_passes_volume_flag_to_afplay() {
        let directory = TempDir::new().expect("tempdir must exist");
        let audio = executable(directory.path(), "audio.aiff", "exit 0");
        let afplay = executable(
            directory.path(),
            "afplay-checks-volume",
            "[ \"$1\" = \"-v\" ] || exit 30\n[ \"$2\" = \"0.5\" ] || exit 31",
        );

        run_playback(afplay, &audio, Some(0.5)).expect("playback with volume must succeed");
    }
}
