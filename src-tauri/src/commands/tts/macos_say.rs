use super::{
    output_details, play_audio_file, truncate, TtsAvailability, TtsCommandError, TtsProviderId,
    TtsProviderInfo, TtsSettings, TtsVoice,
};
use std::{env, ffi::OsStr, process::Command};
use tempfile::NamedTempFile;

const DEFAULT_SAY_EXECUTABLE: &str = "say";
const SAY_EXECUTABLE_ENV: &str = "ENGLISHER_SAY_EXECUTABLE";

pub(super) fn say_executable() -> String {
    env::var(SAY_EXECUTABLE_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SAY_EXECUTABLE.to_string())
}

fn is_locale_token(token: &str) -> bool {
    if token.len() == 2 {
        return token.bytes().all(|byte| byte.is_ascii_lowercase());
    }

    let Some((language, region)) = token.split_once('_') else {
        return false;
    };
    let language_ok = language.len() == 2 && language.bytes().all(|byte| byte.is_ascii_lowercase());
    // Most regions are ISO 3166-1 alpha-2 (e.g. en_US), but a few macOS voices use
    // the UN M49 numeric "world" region instead (e.g. ar_001).
    let region_ok = (region.len() == 2 && region.bytes().all(|byte| byte.is_ascii_uppercase()))
        || (region.len() == 3 && region.bytes().all(|byte| byte.is_ascii_digit()));

    language_ok && region_ok
}

fn parse_voice_line(line: &str) -> Option<TtsVoice> {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let sample_start = trimmed.find('#');
    let head = sample_start.map_or(trimmed, |index| &trimmed[..index]);
    let mut tokens = head.split_whitespace().collect::<Vec<_>>();
    let locale_index = tokens.iter().position(|token| is_locale_token(token))?;
    let locale = tokens.remove(locale_index).to_string();
    if tokens.is_empty() {
        return None;
    }

    let name = tokens.join(" ");
    Some(TtsVoice {
        id: name.clone(),
        label: name,
        locale: Some(locale),
    })
}

fn list_voices(executable: impl AsRef<OsStr>) -> Result<Vec<TtsVoice>, TtsCommandError> {
    let output = Command::new(executable)
        .arg("-v")
        .arg("?")
        .output()
        .map_err(|error| {
            TtsCommandError::new(
                "speech-unavailable",
                "macOS speech could not list voices.",
                error.to_string(),
            )
        })?;

    if !output.status.success() {
        return Err(TtsCommandError::new(
            "speech-unavailable",
            "macOS speech could not list voices.",
            output_details(&output),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut voices = stdout
        .lines()
        .filter_map(parse_voice_line)
        .collect::<Vec<_>>();
    voices.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(voices)
}

fn synthesize_to_file(
    executable: impl AsRef<OsStr>,
    voice: &str,
    rate: Option<f32>,
    reply: &str,
) -> Result<NamedTempFile, TtsCommandError> {
    let file = NamedTempFile::with_suffix(".aiff").map_err(|error| {
        TtsCommandError::new(
            "speech-failed",
            "The speech audio could not be prepared.",
            error.to_string(),
        )
    })?;

    let mut command = Command::new(executable);
    if !voice.is_empty() {
        command.arg("-v").arg(voice);
    }
    if let Some(rate) = rate {
        command.arg("-r").arg(format!("{rate}"));
    }
    command.arg("-o").arg(file.path()).arg(reply);

    let output = command.output().map_err(|error| {
        TtsCommandError::new(
            "speech-unavailable",
            "macOS speech could not be started.",
            error.to_string(),
        )
    })?;

    if !output.status.success() {
        return Err(TtsCommandError::new(
            "speech-failed",
            "macOS speech could not synthesize the tutor reply.",
            output_details(&output),
        ));
    }

    Ok(file)
}

pub(super) async fn speak(
    say_executable: &str,
    afplay_executable: &str,
    settings: &TtsSettings,
    reply: &str,
) -> Result<(), TtsCommandError> {
    let say_executable = say_executable.to_string();
    let voice = settings.voice_id.trim().to_string();
    let rate = settings.rate;
    let volume = settings.volume;
    let reply = reply.to_string();

    let file = tauri::async_runtime::spawn_blocking(move || {
        synthesize_to_file(say_executable, &voice, rate, &reply)
    })
    .await
    .map_err(|error| {
        TtsCommandError::new(
            "speech-failed",
            "The speech task could not complete.",
            error.to_string(),
        )
    })??;

    play_audio_file(
        afplay_executable.to_string(),
        file.path().to_path_buf(),
        volume,
    )
    .await
}

pub(super) async fn provider_info() -> TtsProviderInfo {
    let voices = tauri::async_runtime::spawn_blocking(|| list_voices(say_executable()))
        .await
        .unwrap_or_else(|error| {
            Err(TtsCommandError::new(
                "speech-unavailable",
                "macOS speech could not list voices.",
                error.to_string(),
            ))
        });

    match voices {
        Ok(voices) => TtsProviderInfo {
            id: TtsProviderId::MacosSay,
            label: TtsProviderId::MacosSay.label().to_string(),
            availability: TtsAvailability {
                available: true,
                message: "macOS speech is ready.".to_string(),
                technical_message: None,
            },
            voices,
            supports_rate: true,
            supports_volume: true,
        },
        Err(error) => TtsProviderInfo {
            id: TtsProviderId::MacosSay,
            label: TtsProviderId::MacosSay.label().to_string(),
            availability: TtsAvailability {
                available: false,
                message: "macOS speech is unavailable.".to_string(),
                technical_message: Some(truncate(&error.technical_message)),
            },
            voices: Vec::new(),
            supports_rate: true,
            supports_volume: true,
        },
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};
    use tempfile::TempDir;

    fn executable(directory: &std::path::Path, name: &str, script: &str) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).expect("script must write");
        let mut permissions = fs::metadata(&path)
            .expect("script metadata must exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("script must be executable");
        path
    }

    #[test]
    fn synthesize_passes_reply_as_one_process_argument_without_voice_or_rate() {
        let directory = TempDir::new().expect("tempdir must exist");
        let expected = "Hello; $(touch /tmp/englisher-bad) && echo hacked";
        let say = executable(
            directory.path(),
            "say-test",
            &format!(
                "[ \"$#\" = \"3\" ] || exit 31\n[ \"$1\" = \"-o\" ] || exit 32\n[ \"$3\" = '{expected}' ] || exit 33"
            ),
        );

        synthesize_to_file(say, "", None, expected).expect("safe argument passing must succeed");
    }

    #[test]
    fn synthesize_passes_voice_and_rate_flags_before_output_and_reply() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-flags",
            "[ \"$#\" = \"7\" ] || exit 34\n\
             [ \"$1\" = \"-v\" ] || exit 35\n\
             [ \"$2\" = \"Daniel\" ] || exit 36\n\
             [ \"$3\" = \"-r\" ] || exit 37\n\
             [ \"$4\" = \"210\" ] || exit 38\n\
             [ \"$5\" = \"-o\" ] || exit 39\n\
             [ \"$7\" = \"Good morning.\" ] || exit 40",
        );

        synthesize_to_file(say, "Daniel", Some(210.0), "Good morning.")
            .expect("voice and rate flags must be passed in order");
    }

    #[test]
    fn synthesize_surfaces_failed_process_output() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-fails",
            "echo 'voice unavailable' >&2\nexit 42",
        );

        let error = synthesize_to_file(say, "", None, "Please speak this.")
            .expect_err("failed speech process must surface");

        assert_eq!(error.code, "speech-failed");
        assert!(error.technical_message.contains("voice unavailable"));
    }

    #[test]
    fn parse_voice_line_extracts_name_and_locale() {
        let voice = parse_voice_line("Alex                en_US    # Most people recognize me by my voice.")
            .expect("line must parse");
        assert_eq!(voice.label, "Alex");
        assert_eq!(voice.locale.as_deref(), Some("en_US"));
    }

    #[test]
    fn parse_voice_line_joins_multi_word_names() {
        let voice = parse_voice_line("Bad News            en_US    # ...")
            .expect("line must parse");
        assert_eq!(voice.label, "Bad News");
        assert_eq!(voice.locale.as_deref(), Some("en_US"));
    }

    #[test]
    fn parse_voice_line_handles_parenthesized_variant_names() {
        let voice = parse_voice_line("Eddy (English (UK))              en_GB    # ...")
            .expect("line must parse");
        assert_eq!(voice.label, "Eddy (English (UK))");
        assert_eq!(voice.locale.as_deref(), Some("en_GB"));
    }

    #[test]
    fn parse_voice_line_accepts_un_m49_numeric_regions() {
        let voice = parse_voice_line("Majed               ar_001   # ...")
            .expect("line must parse");
        assert_eq!(voice.label, "Majed");
        assert_eq!(voice.locale.as_deref(), Some("ar_001"));
    }

    #[test]
    fn parse_voice_line_rejects_lines_without_locale() {
        assert!(parse_voice_line("not a voice line").is_none());
        assert!(parse_voice_line("").is_none());
    }

    #[test]
    fn list_voices_parses_and_sorts_sample_output() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-list",
            "cat <<'EOF'\n\
             Fred                en_US    # I sure like being inside this fancy computer\n\
             Alex                en_US    # Most people recognize me by my voice.\n\
             EOF",
        );

        let voices = list_voices(say).expect("voice list must parse");
        assert_eq!(voices.len(), 2);
        assert_eq!(voices[0].label, "Alex");
        assert_eq!(voices[1].label, "Fred");
    }
}
