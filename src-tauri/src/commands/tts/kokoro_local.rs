use super::{
    output_details, play_audio_file, TtsAvailability, TtsCommandError, TtsProviderId,
    TtsProviderInfo, TtsSettings, TtsVoice,
};
use std::{ffi::OsStr, path::Path, process::Command};
use tempfile::NamedTempFile;

const DEFAULT_STYLE: &str = "af_sarah";

fn voice(id: &str, label: &str, locale: &str) -> TtsVoice {
    TtsVoice {
        id: id.to_string(),
        label: label.to_string(),
        locale: Some(locale.to_string()),
        preview_url: None,
    }
}

fn known_voices() -> Vec<TtsVoice> {
    vec![
        voice("af_alice", "Alice", "en-US"),
        voice("af_bella", "Bella", "en-US"),
        voice("af_nicole", "Nicole", "en-US"),
        voice("af_river", "River", "en-US"),
        voice("af_sarah", "Sarah", "en-US"),
        voice("af_sky", "Sky", "en-US"),
        voice("am_adam", "Adam", "en-US"),
        voice("am_eric", "Eric", "en-US"),
        voice("am_liam", "Liam", "en-US"),
        voice("am_michael", "Michael", "en-US"),
        voice("bf_emma", "Emma", "en-GB"),
        voice("bf_isabella", "Isabella", "en-GB"),
        voice("bf_sophia", "Sophia", "en-GB"),
        voice("bm_george", "George", "en-GB"),
        voice("bm_lewis", "Lewis", "en-GB"),
    ]
}

struct MissingPaths {
    executable: bool,
    model: bool,
    voices: bool,
}

fn missing_paths(settings: &TtsSettings) -> MissingPaths {
    MissingPaths {
        executable: !is_configured_file(&settings.kokoro_executable_path),
        model: !is_configured_file(&settings.kokoro_model_path),
        voices: !is_configured_file(&settings.kokoro_voices_path),
    }
}

fn is_configured_file(value: &str) -> bool {
    !value.is_empty() && Path::new(value).is_file()
}

impl MissingPaths {
    fn any(&self) -> bool {
        self.executable || self.model || self.voices
    }

    fn describe(&self) -> String {
        let mut missing = Vec::new();
        if self.executable {
            missing.push("the koko executable");
        }
        if self.model {
            missing.push("the Kokoro model file");
        }
        if self.voices {
            missing.push("the Kokoro voices data file");
        }
        format!("Set a valid path for {}.", missing.join(", "))
    }
}

pub(super) async fn provider_info(settings: &TtsSettings) -> TtsProviderInfo {
    let missing = missing_paths(settings);
    let available = !missing.any();

    TtsProviderInfo {
        id: TtsProviderId::KokoroLocal,
        label: TtsProviderId::KokoroLocal.label().to_string(),
        availability: TtsAvailability {
            available,
            message: if available {
                "Kokoro local model is ready.".to_string()
            } else {
                missing.describe()
            },
            technical_message: None,
        },
        voices: if available { known_voices() } else { Vec::new() },
        supports_rate: false,
        supports_volume: true,
    }
}

fn synthesize_to_file(
    executable: impl AsRef<OsStr>,
    model_path: &str,
    voices_path: &str,
    style: &str,
    reply: &str,
) -> Result<NamedTempFile, TtsCommandError> {
    let file = NamedTempFile::with_suffix(".wav").map_err(|error| {
        TtsCommandError::new(
            "speech-failed",
            "The speech audio could not be prepared.",
            error.to_string(),
        )
    })?;

    let mut command = Command::new(executable);
    command
        .arg("--model")
        .arg(model_path)
        .arg("--data")
        .arg(voices_path)
        .arg("--style")
        .arg(style)
        .arg("text")
        .arg(reply)
        .arg("--output")
        .arg(file.path());

    let output = command.output().map_err(|error| {
        TtsCommandError::new(
            "speech-unavailable",
            "Kokoro local speech could not be started.",
            error.to_string(),
        )
    })?;

    if !output.status.success() {
        return Err(TtsCommandError::new(
            "speech-failed",
            "Kokoro local speech could not synthesize the tutor reply.",
            output_details(&output),
        ));
    }

    Ok(file)
}

pub(super) async fn speak(settings: &TtsSettings, reply: &str) -> Result<(), TtsCommandError> {
    let missing = missing_paths(settings);
    if missing.any() {
        return Err(TtsCommandError::new(
            "kokoro-unavailable",
            "Kokoro local speech is not available yet.",
            missing.describe(),
        ));
    }

    let executable = settings.kokoro_executable_path.clone();
    let model_path = settings.kokoro_model_path.clone();
    let voices_path = settings.kokoro_voices_path.clone();
    let style = settings.voice_id.trim().to_string();
    let style = if style.is_empty() {
        DEFAULT_STYLE.to_string()
    } else {
        style
    };
    let volume = settings.volume;
    let reply = reply.to_string();

    let file = tauri::async_runtime::spawn_blocking(move || {
        synthesize_to_file(executable, &model_path, &voices_path, &style, &reply)
    })
    .await
    .map_err(|error| {
        TtsCommandError::new(
            "speech-failed",
            "The speech task could not complete.",
            error.to_string(),
        )
    })??;

    play_audio_file(super::afplay_executable(), file.path().to_path_buf(), volume).await
}

#[cfg(all(test, unix))]
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

    fn ready_settings(directory: &Path, koko: PathBuf) -> TtsSettings {
        let model = directory.join("kokoro-v1.0.onnx");
        let voices = directory.join("voices-v1.0.bin");
        fs::write(&model, "model").expect("model must write");
        fs::write(&voices, "voices").expect("voices must write");

        TtsSettings {
            provider: TtsProviderId::KokoroLocal,
            voice_id: String::new(),
            rate: None,
            volume: None,
            kokoro_executable_path: koko.display().to_string(),
            kokoro_model_path: model.display().to_string(),
            kokoro_voices_path: voices.display().to_string(),
        }
    }

    #[test]
    fn provider_info_reports_missing_paths() {
        let settings = TtsSettings {
            provider: TtsProviderId::KokoroLocal,
            voice_id: String::new(),
            rate: None,
            volume: None,
            kokoro_executable_path: String::new(),
            kokoro_model_path: String::new(),
            kokoro_voices_path: String::new(),
        };

        let info = tauri::async_runtime::block_on(provider_info(&settings));

        assert!(!info.availability.available);
        assert!(info.voices.is_empty());
        assert!(info.availability.message.contains("koko executable"));
    }

    #[test]
    fn provider_info_reports_ready_when_all_paths_exist() {
        let directory = TempDir::new().expect("tempdir must exist");
        let koko = executable(directory.path(), "koko", "exit 0");
        let settings = ready_settings(directory.path(), koko);

        let info = tauri::async_runtime::block_on(provider_info(&settings));

        assert!(info.availability.available);
        assert!(!info.voices.is_empty());
    }

    #[test]
    fn synthesize_passes_flags_in_order() {
        let directory = TempDir::new().expect("tempdir must exist");
        let koko = executable(
            directory.path(),
            "koko",
            "[ \"$1\" = \"--model\" ] || exit 21\n\
             [ \"$3\" = \"--data\" ] || exit 22\n\
             [ \"$5\" = \"--style\" ] || exit 23\n\
             [ \"$6\" = \"af_sarah\" ] || exit 24\n\
             [ \"$7\" = \"text\" ] || exit 25\n\
             [ \"$8\" = \"Good morning.\" ] || exit 26\n\
             [ \"$9\" = \"--output\" ] || exit 27\n\
             printf 'wav' > \"${10}\"",
        );

        let file = synthesize_to_file(koko, "model.onnx", "voices.bin", "af_sarah", "Good morning.")
            .expect("synthesis must succeed");
        assert_eq!(fs::read_to_string(file.path()).unwrap(), "wav");
    }

    #[test]
    fn synthesize_surfaces_failed_process_output() {
        let directory = TempDir::new().expect("tempdir must exist");
        let koko = executable(
            directory.path(),
            "koko-fails",
            "echo 'model load failed' >&2\nexit 42",
        );

        let error = synthesize_to_file(koko, "model.onnx", "voices.bin", "af_sarah", "Hi.")
            .expect_err("failed synthesis must surface");

        assert_eq!(error.code, "speech-failed");
        assert!(error.technical_message.contains("model load failed"));
    }

    #[test]
    fn speak_fails_fast_when_paths_are_not_configured() {
        let settings = TtsSettings {
            provider: TtsProviderId::KokoroLocal,
            voice_id: String::new(),
            rate: None,
            volume: None,
            kokoro_executable_path: String::new(),
            kokoro_model_path: String::new(),
            kokoro_voices_path: String::new(),
        };

        let error = tauri::async_runtime::block_on(speak(&settings, "Hello there."))
            .expect_err("speak must fail without configured paths");

        assert_eq!(error.code, "kokoro-unavailable");
    }
}
