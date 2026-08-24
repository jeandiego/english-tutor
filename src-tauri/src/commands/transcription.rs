use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
};
use tauri::{AppHandle, Manager};
use tempfile::{Builder, NamedTempFile};

const CONFIG_FILE_NAME: &str = "transcription.json";
const TECHNICAL_OUTPUT_LIMIT: usize = 4_096;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSettings {
    whisper_executable_path: String,
    whisper_model_path: String,
    ffmpeg_executable_path: String,
}

impl Default for TranscriptionSettings {
    fn default() -> Self {
        Self {
            whisper_executable_path: String::new(),
            whisper_model_path: String::new(),
            ffmpeg_executable_path: "ffmpeg".to_string(),
        }
    }
}

impl TranscriptionSettings {
    fn normalized(mut self) -> Self {
        self.whisper_executable_path = self.whisper_executable_path.trim().to_string();
        self.whisper_model_path = self.whisper_model_path.trim().to_string();
        self.ffmpeg_executable_path = self.ffmpeg_executable_path.trim().to_string();
        self
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptionDependency {
    WhisperExecutable,
    WhisperModel,
    FfmpegExecutable,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DependencyStatus {
    Ready,
    NotConfigured,
    NotFound,
    NotRunnable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyCheck {
    dependency: TranscriptionDependency,
    status: DependencyStatus,
    message: String,
    technical_message: Option<String>,
}

impl DependencyCheck {
    fn ready(dependency: TranscriptionDependency, message: impl Into<String>) -> Self {
        Self {
            dependency,
            status: DependencyStatus::Ready,
            message: message.into(),
            technical_message: None,
        }
    }

    fn problem(
        dependency: TranscriptionDependency,
        status: DependencyStatus,
        message: impl Into<String>,
        technical_message: Option<String>,
    ) -> Self {
        Self {
            dependency,
            status,
            message: message.into(),
            technical_message,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PreflightStatus {
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionPreflight {
    status: PreflightStatus,
    checks: Vec<DependencyCheck>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSetup {
    settings: TranscriptionSettings,
    preflight: TranscriptionPreflight,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    audio_bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    text: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl TranscriptionCommandError {
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

fn config_path(app_handle: &AppHandle) -> Result<PathBuf, TranscriptionCommandError> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|error| {
            TranscriptionCommandError::new(
                "configuration-read-failed",
                "The transcription settings location is unavailable.",
                error.to_string(),
            )
        })
}

fn temp_root(app_handle: &AppHandle) -> Result<PathBuf, TranscriptionCommandError> {
    app_handle.path().temp_dir().map_err(|error| {
        TranscriptionCommandError::new(
            "temporary-io-failed",
            "A temporary audio directory could not be resolved.",
            error.to_string(),
        )
    })
}

fn read_settings(path: &Path) -> Result<TranscriptionSettings, TranscriptionCommandError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(TranscriptionSettings::default())
        }
        Err(error) => {
            return Err(TranscriptionCommandError::new(
                "configuration-read-failed",
                "The transcription settings could not be read.",
                error.to_string(),
            ))
        }
    };

    serde_json::from_slice::<TranscriptionSettings>(&content)
        .map(TranscriptionSettings::normalized)
        .map_err(|error| {
            TranscriptionCommandError::new(
                "configuration-read-failed",
                "The transcription settings file is invalid.",
                error.to_string(),
            )
        })
}

fn write_settings(
    path: &Path,
    settings: &TranscriptionSettings,
) -> Result<(), TranscriptionCommandError> {
    let directory = path.parent().ok_or_else(|| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings location is invalid.",
            path.display().to_string(),
        )
    })?;

    fs::create_dir_all(directory).map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings directory could not be created.",
            error.to_string(),
        )
    })?;

    let mut temporary = NamedTempFile::new_in(directory).map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings could not be saved.",
            error.to_string(),
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, settings).map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings could not be serialized.",
            error.to_string(),
        )
    })?;
    temporary.flush().map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings could not be saved.",
            error.to_string(),
        )
    })?;
    temporary.persist(path).map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings could not be saved.",
            error.error.to_string(),
        )
    })?;

    Ok(())
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

fn executable_check(
    dependency: TranscriptionDependency,
    configured_value: &str,
    field_name: &str,
    version_argument: &str,
) -> DependencyCheck {
    if configured_value.is_empty() {
        return DependencyCheck::problem(
            dependency,
            DependencyStatus::NotConfigured,
            format!("Set the {field_name}."),
            None,
        );
    }

    let configured_path = Path::new(configured_value);
    if configured_path.components().count() > 1 && !configured_path.is_file() {
        return DependencyCheck::problem(
            dependency,
            DependencyStatus::NotFound,
            format!("The configured {field_name} does not exist: {configured_value}"),
            None,
        );
    }

    match Command::new(configured_value)
        .arg(version_argument)
        .output()
    {
        Ok(output) if output.status.success() => {
            DependencyCheck::ready(dependency, format!("{field_name} is available."))
        }
        Ok(output) => DependencyCheck::problem(
            dependency,
            DependencyStatus::NotRunnable,
            format!("The configured {field_name} could not be invoked successfully."),
            Some(output_details(&output)),
        ),
        Err(error) if error.kind() == ErrorKind::NotFound => DependencyCheck::problem(
            dependency,
            DependencyStatus::NotFound,
            format!("The configured {field_name} is not resolvable: {configured_value}"),
            Some(error.to_string()),
        ),
        Err(error) => DependencyCheck::problem(
            dependency,
            DependencyStatus::NotRunnable,
            format!("The configured {field_name} cannot be invoked."),
            Some(error.to_string()),
        ),
    }
}

fn model_check(configured_value: &str) -> DependencyCheck {
    if configured_value.is_empty() {
        return DependencyCheck::problem(
            TranscriptionDependency::WhisperModel,
            DependencyStatus::NotConfigured,
            "Set the Whisper model path.",
            None,
        );
    }

    let model_path = Path::new(configured_value);
    match fs::metadata(model_path) {
        Ok(metadata) if !metadata.is_file() => {
            return DependencyCheck::problem(
                TranscriptionDependency::WhisperModel,
                DependencyStatus::NotFound,
                format!("The configured Whisper model is not a file: {configured_value}"),
                None,
            )
        }
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return DependencyCheck::problem(
                TranscriptionDependency::WhisperModel,
                DependencyStatus::NotFound,
                format!("The configured Whisper model does not exist: {configured_value}"),
                None,
            )
        }
        Err(error) => {
            return DependencyCheck::problem(
                TranscriptionDependency::WhisperModel,
                DependencyStatus::NotRunnable,
                "The configured Whisper model is not readable.",
                Some(error.to_string()),
            )
        }
    }

    match File::open(model_path) {
        Ok(_) => DependencyCheck::ready(
            TranscriptionDependency::WhisperModel,
            "Whisper model is available.",
        ),
        Err(error) => DependencyCheck::problem(
            TranscriptionDependency::WhisperModel,
            DependencyStatus::NotRunnable,
            "The configured Whisper model is not readable.",
            Some(error.to_string()),
        ),
    }
}

fn preflight(settings: &TranscriptionSettings) -> TranscriptionPreflight {
    let checks = vec![
        executable_check(
            TranscriptionDependency::WhisperExecutable,
            &settings.whisper_executable_path,
            "Whisper executable path",
            "--version",
        ),
        model_check(&settings.whisper_model_path),
        executable_check(
            TranscriptionDependency::FfmpegExecutable,
            &settings.ffmpeg_executable_path,
            "FFmpeg executable path",
            "-version",
        ),
    ];
    let status = if checks
        .iter()
        .all(|check| check.status == DependencyStatus::Ready)
    {
        PreflightStatus::Ready
    } else {
        PreflightStatus::Error
    };

    TranscriptionPreflight { status, checks }
}

fn setup(settings: TranscriptionSettings) -> TranscriptionSetup {
    let preflight = preflight(&settings);
    TranscriptionSetup {
        settings,
        preflight,
    }
}

fn source_extension(mime_type: &str) -> &'static str {
    match mime_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "audio/webm" => "webm",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/wave" | "audio/x-wav" => "wav",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        _ => "bin",
    }
}

fn dependency_error(preflight: &TranscriptionPreflight) -> TranscriptionCommandError {
    let messages = preflight
        .checks
        .iter()
        .filter(|check| check.status != DependencyStatus::Ready)
        .map(|check| check.message.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    TranscriptionCommandError::new(
        "dependency-not-ready",
        messages,
        "Local transcription preflight did not pass.",
    )
}

fn run_transcription(
    settings: &TranscriptionSettings,
    request: TranscriptionRequest,
    temporary_root: &Path,
) -> Result<TranscriptionResult, TranscriptionCommandError> {
    if request.audio_bytes.is_empty() {
        return Err(TranscriptionCommandError::new(
            "invalid-audio",
            "The recording did not contain any audio data.",
            "transcribe_audio received an empty byte array.",
        ));
    }

    let temporary = Builder::new()
        .prefix("englisher-stt-")
        .tempdir_in(temporary_root)
        .map_err(|error| {
            TranscriptionCommandError::new(
                "temporary-io-failed",
                "A temporary audio directory could not be created.",
                error.to_string(),
            )
        })?;
    let input_path = temporary.path().join(format!(
        "recording.{}",
        source_extension(&request.mime_type)
    ));
    let wav_path = temporary.path().join("recording.wav");

    let transcription_result = (|| {
        fs::write(&input_path, request.audio_bytes).map_err(|error| {
            TranscriptionCommandError::new(
                "temporary-io-failed",
                "The recording could not be prepared for transcription.",
                error.to_string(),
            )
        })?;

        let conversion = Command::new(&settings.ffmpeg_executable_path)
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y"])
            .arg("-i")
            .arg(&input_path)
            .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
            .arg(&wav_path)
            .output()
            .map_err(|error| {
                TranscriptionCommandError::new(
                    "conversion-failed",
                    "The recording could not be converted to Whisper-compatible audio.",
                    error.to_string(),
                )
            })?;

        if !conversion.status.success() {
            return Err(TranscriptionCommandError::new(
                "conversion-failed",
                "The recording could not be converted to Whisper-compatible audio.",
                output_details(&conversion),
            ));
        }

        match fs::metadata(&wav_path) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => {}
            Ok(_) => {
                return Err(TranscriptionCommandError::new(
                    "conversion-failed",
                    "The recording could not be converted to Whisper-compatible audio.",
                    "FFmpeg completed without producing a non-empty WAV file.",
                ))
            }
            Err(error) => {
                return Err(TranscriptionCommandError::new(
                    "conversion-failed",
                    "The recording could not be converted to Whisper-compatible audio.",
                    error.to_string(),
                ))
            }
        }

        let whisper = Command::new(&settings.whisper_executable_path)
            .arg("--model")
            .arg(&settings.whisper_model_path)
            .arg("--file")
            .arg(&wav_path)
            .args(["--language", "en", "--no-timestamps", "--no-prints"])
            .output()
            .map_err(|error| {
                TranscriptionCommandError::new(
                    "whisper-process-failed",
                    "Whisper could not be started.",
                    error.to_string(),
                )
            })?;

        if !whisper.status.success() {
            return Err(TranscriptionCommandError::new(
                "whisper-process-failed",
                "Whisper could not transcribe the recording.",
                output_details(&whisper),
            ));
        }

        let text = String::from_utf8_lossy(&whisper.stdout).trim().to_string();
        if text.is_empty() {
            return Err(TranscriptionCommandError::new(
                "empty-transcription",
                "No English speech was recognized. Hold the control a little longer and try again.",
                output_details(&whisper),
            ));
        }

        Ok(TranscriptionResult { text })
    })();

    if let Err(error) = temporary.close() {
        if transcription_result.is_ok() {
            return Err(TranscriptionCommandError::new(
                "temporary-io-failed",
                "Temporary transcription files could not be removed.",
                error.to_string(),
            ));
        }
    }

    transcription_result
}

#[tauri::command]
pub async fn load_transcription_setup(
    app_handle: AppHandle,
) -> Result<TranscriptionSetup, TranscriptionCommandError> {
    let path = config_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || read_settings(&path).map(setup))
        .await
        .map_err(|error| {
            TranscriptionCommandError::new(
                "configuration-read-failed",
                "The transcription settings check could not complete.",
                error.to_string(),
            )
        })?
}

#[tauri::command]
pub async fn save_transcription_settings(
    app_handle: AppHandle,
    settings: TranscriptionSettings,
) -> Result<TranscriptionSetup, TranscriptionCommandError> {
    let path = config_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = settings.normalized();
        write_settings(&path, &settings)?;
        Ok(setup(settings))
    })
    .await
    .map_err(|error| {
        TranscriptionCommandError::new(
            "configuration-write-failed",
            "The transcription settings check could not complete.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn transcribe_audio(
    app_handle: AppHandle,
    request: TranscriptionRequest,
) -> Result<TranscriptionResult, TranscriptionCommandError> {
    let path = config_path(&app_handle)?;
    let temporary_root = temp_root(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = read_settings(&path)?;
        let readiness = preflight(&settings);
        if readiness.status != PreflightStatus::Ready {
            return Err(dependency_error(&readiness));
        }

        run_transcription(&settings, request, &temporary_root)
    })
    .await
    .map_err(|error| {
        TranscriptionCommandError::new(
            "whisper-process-failed",
            "The transcription task could not complete.",
            error.to_string(),
        )
    })?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
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

    fn ready_settings(directory: &Path) -> TranscriptionSettings {
        let whisper = executable(
            directory,
            "whisper-cli",
            "if [ \"$1\" = \"--version\" ]; then echo whisper-test; exit 0; fi\n[ \"$1\" = \"--model\" ] || exit 21\n[ \"$3\" = \"--file\" ] || exit 22\n[ \"$5\" = \"--language\" ] || exit 23\n[ \"$6\" = \"en\" ] || exit 24\n[ \"$7\" = \"--no-timestamps\" ] || exit 25\n[ \"$8\" = \"--no-prints\" ] || exit 26\necho 'A local English transcript.'",
        );
        let ffmpeg = executable(
            directory,
            "ffmpeg",
            "if [ \"$1\" = \"-version\" ]; then echo ffmpeg-test; exit 0; fi\n[ \"$1\" = \"-nostdin\" ] || exit 31\n[ \"$2\" = \"-hide_banner\" ] || exit 32\n[ \"$3\" = \"-loglevel\" ] || exit 33\n[ \"$4\" = \"error\" ] || exit 34\n[ \"$8\" = \"-vn\" ] || exit 35\n[ \"$9\" = \"-ac\" ] || exit 36\n[ \"${10}\" = \"1\" ] || exit 37\n[ \"${11}\" = \"-ar\" ] || exit 38\n[ \"${12}\" = \"16000\" ] || exit 39\n[ \"${13}\" = \"-c:a\" ] || exit 40\n[ \"${14}\" = \"pcm_s16le\" ] || exit 41\nfor last; do true; done\nprintf 'wav' > \"$last\"",
        );
        let model = directory.join("model.bin");
        fs::write(&model, "model").expect("model must write");
        TranscriptionSettings {
            whisper_executable_path: whisper.display().to_string(),
            whisper_model_path: model.display().to_string(),
            ffmpeg_executable_path: ffmpeg.display().to_string(),
        }
    }

    #[test]
    fn missing_file_uses_actionable_defaults() {
        let directory = TempDir::new().expect("tempdir must exist");
        let settings = read_settings(&directory.path().join("missing.json"))
            .expect("missing config should use defaults");
        let readiness = preflight(&settings);

        assert_eq!(settings.ffmpeg_executable_path, "ffmpeg");
        assert_eq!(readiness.status, PreflightStatus::Error);
        assert_eq!(readiness.checks[0].status, DependencyStatus::NotConfigured);
        assert_eq!(readiness.checks[1].message, "Set the Whisper model path.");
    }

    #[test]
    fn settings_round_trip_and_trim_paths() {
        let directory = TempDir::new().expect("tempdir must exist");
        let path = directory.path().join("nested/transcription.json");
        let settings = TranscriptionSettings {
            whisper_executable_path: "  whisper-cli ".into(),
            whisper_model_path: "  /tmp/model.bin ".into(),
            ffmpeg_executable_path: " ffmpeg ".into(),
        }
        .normalized();

        write_settings(&path, &settings).expect("settings must write");
        assert_eq!(read_settings(&path).expect("settings must read"), settings);
    }

    #[test]
    fn preflight_reports_missing_and_non_runnable_dependencies() {
        let directory = TempDir::new().expect("tempdir must exist");
        let non_runnable = directory.path().join("whisper-cli");
        fs::write(&non_runnable, "not executable").expect("fixture must write");
        let settings = TranscriptionSettings {
            whisper_executable_path: non_runnable.display().to_string(),
            whisper_model_path: directory.path().join("missing.bin").display().to_string(),
            ffmpeg_executable_path: directory
                .path()
                .join("missing-ffmpeg")
                .display()
                .to_string(),
        };

        let readiness = preflight(&settings);

        assert_eq!(readiness.status, PreflightStatus::Error);
        assert_eq!(readiness.checks[0].status, DependencyStatus::NotRunnable);
        assert_eq!(readiness.checks[1].status, DependencyStatus::NotFound);
        assert_eq!(readiness.checks[2].status, DependencyStatus::NotFound);
    }

    #[test]
    fn preflight_resolves_bare_executable_names_through_path() {
        let directory = TempDir::new().expect("tempdir must exist");
        let model = directory.path().join("model.bin");
        fs::write(&model, "model").expect("model must write");
        let settings = TranscriptionSettings {
            whisper_executable_path: "true".into(),
            whisper_model_path: model.display().to_string(),
            ffmpeg_executable_path: "true".into(),
        };

        assert_eq!(preflight(&settings).status, PreflightStatus::Ready);
    }

    #[test]
    fn successful_pipeline_returns_text_and_removes_temp_directory() {
        let fixtures = TempDir::new().expect("fixtures must exist");
        let temp_root = TempDir::new().expect("temp root must exist");
        let settings = ready_settings(fixtures.path());
        assert_eq!(preflight(&settings).status, PreflightStatus::Ready);

        let result = run_transcription(
            &settings,
            TranscriptionRequest {
                audio_bytes: b"webm audio".to_vec(),
                mime_type: "audio/webm;codecs=opus".into(),
            },
            temp_root.path(),
        )
        .expect("transcription must succeed");

        assert_eq!(result.text, "A local English transcript.");
        assert_eq!(
            fs::read_dir(temp_root.path())
                .expect("temp root must be readable")
                .count(),
            0
        );
    }

    #[test]
    fn reports_conversion_whisper_and_empty_transcription_failures() {
        let fixtures = TempDir::new().expect("fixtures must exist");
        let temp_root = TempDir::new().expect("temp root must exist");
        let mut settings = ready_settings(fixtures.path());
        settings.ffmpeg_executable_path = executable(fixtures.path(), "bad-ffmpeg", "exit 7")
            .display()
            .to_string();
        let request = || TranscriptionRequest {
            audio_bytes: b"audio".to_vec(),
            mime_type: "audio/mp4".into(),
        };

        assert_eq!(
            run_transcription(&settings, request(), temp_root.path())
                .expect_err("conversion must fail")
                .code,
            "conversion-failed"
        );

        settings.ffmpeg_executable_path = executable(
            fixtures.path(),
            "good-ffmpeg",
            "if [ \"$1\" = \"-version\" ]; then exit 0; fi\nfor last; do true; done\nprintf wav > \"$last\"",
        )
        .display()
        .to_string();
        settings.whisper_executable_path = executable(
            fixtures.path(),
            "bad-whisper",
            "if [ \"$1\" = \"--version\" ]; then exit 0; fi\nexit 9",
        )
        .display()
        .to_string();
        assert_eq!(
            run_transcription(&settings, request(), temp_root.path())
                .expect_err("whisper must fail")
                .code,
            "whisper-process-failed"
        );

        settings.whisper_executable_path = executable(
            fixtures.path(),
            "empty-whisper",
            "if [ \"$1\" = \"--version\" ]; then exit 0; fi\nexit 0",
        )
        .display()
        .to_string();
        assert_eq!(
            run_transcription(&settings, request(), temp_root.path())
                .expect_err("empty transcription must fail")
                .code,
            "empty-transcription"
        );
    }

    #[test]
    fn maps_known_mime_types_to_safe_extensions() {
        assert_eq!(source_extension("audio/webm;codecs=opus"), "webm");
        assert_eq!(source_extension("audio/mp4"), "m4a");
        assert_eq!(source_extension("../../unsafe"), "bin");
    }
}
