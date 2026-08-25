use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::OsStr,
    process::{Command, Output},
};

const DEFAULT_SPEECH_EXECUTABLE: &str = "say";
const SPEECH_EXECUTABLE_ENV: &str = "ENGLISHER_SAY_EXECUTABLE";
const TECHNICAL_OUTPUT_LIMIT: usize = 4_096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    reply: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl SpeechCommandError {
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

fn speech_executable() -> String {
    env::var(SPEECH_EXECUTABLE_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SPEECH_EXECUTABLE.to_string())
}

fn run_speech(
    executable: impl AsRef<OsStr>,
    request: SpeechRequest,
) -> Result<(), SpeechCommandError> {
    let reply = request.reply.trim().to_string();
    if reply.is_empty() {
        return Err(SpeechCommandError::new(
            "invalid-speech",
            "The tutor reply was empty, so it could not be spoken.",
            "speak_tutor_reply received an empty reply.",
        ));
    }

    let output = Command::new(executable)
        .arg(reply)
        .output()
        .map_err(|error| {
            SpeechCommandError::new(
                "speech-unavailable",
                "macOS speech could not be started.",
                error.to_string(),
            )
        })?;

    if !output.status.success() {
        return Err(SpeechCommandError::new(
            "speech-failed",
            "macOS speech could not play the tutor reply.",
            output_details(&output),
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn speak_tutor_reply(request: SpeechRequest) -> Result<(), SpeechCommandError> {
    tauri::async_runtime::spawn_blocking(move || run_speech(speech_executable(), request))
        .await
        .map_err(|error| {
            SpeechCommandError::new(
                "speech-failed",
                "The speech task could not complete.",
                error.to_string(),
            )
        })?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        path::{Path, PathBuf},
    };
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

    #[test]
    fn speech_passes_reply_as_one_process_argument() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-test",
            "expected='Hello; $(touch /tmp/englisher-bad) && echo hacked'\n[ \"$#\" = \"1\" ] || exit 31\n[ \"$1\" = \"$expected\" ] || exit 32",
        );

        run_speech(
            say,
            SpeechRequest {
                reply: "Hello; $(touch /tmp/englisher-bad) && echo hacked".into(),
            },
        )
        .expect("safe argument passing must succeed");
    }

    #[test]
    fn speech_rejects_empty_replies() {
        let error = run_speech(
            "say",
            SpeechRequest {
                reply: "   ".into(),
            },
        )
        .expect_err("empty reply must fail before process spawn");

        assert_eq!(error.code, "invalid-speech");
    }

    #[test]
    fn speech_surfaces_failed_process_output() {
        let directory = TempDir::new().expect("tempdir must exist");
        let say = executable(
            directory.path(),
            "say-fails",
            "echo 'voice unavailable' >&2\nexit 42",
        );

        let error = run_speech(
            say,
            SpeechRequest {
                reply: "Please speak this.".into(),
            },
        )
        .expect_err("failed speech process must surface");

        assert_eq!(error.code, "speech-failed");
        assert!(error.technical_message.contains("voice unavailable"));
    }
}
