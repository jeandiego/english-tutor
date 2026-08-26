use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use super::assessment::{cefr_level_str, AssessmentCompetency, CefrLevel};
use super::history::{self, HistoryCommandError};

const CONFIG_FILE_NAME: &str = "learner_profile.json";
const RECENT_CORRECTIONS_WINDOW: i64 = 50;
const RECURRING_MIN_COUNT: i64 = 2;
const SUMMARY_MAX_CATEGORIES: usize = 2;
const RECENT_VOCABULARY_LIMIT: i64 = 8;
const MAX_PROGRESS_NOTES: usize = 20;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl LearnerProfileCommandError {
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

    pub(crate) fn into_parts(self) -> (&'static str, String, String) {
        (self.code, self.message, self.technical_message)
    }
}

impl From<rusqlite::Error> for LearnerProfileCommandError {
    fn from(error: rusqlite::Error) -> Self {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile could not be read.",
            error.to_string(),
        )
    }
}

impl From<HistoryCommandError> for LearnerProfileCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<LearnerProfileCommandError> for HistoryCommandError {
    fn from(error: LearnerProfileCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        HistoryCommandError::new(code, message, technical_message)
    }
}

// ---------------------------------------------------------------------
// Persisted, declared/derived-and-cached data (single JSON file, same
// atomic-write pattern as TutorSettings/TranscriptionSettings). Observed
// data that's cheap to recompute (recurring correction categories, recent
// vocabulary suggestions) is queried live from history.sqlite3 instead of
// being duplicated here — see compose_profile_response below.
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgressNoteOrigin {
    Assessment,
    Session,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressNote {
    text: String,
    origin: ProgressNoteOrigin,
    created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileData {
    #[serde(default)]
    current_level: Option<CefrLevel>,
    #[serde(default)]
    dimension_levels: HashMap<AssessmentCompetency, CefrLevel>,
    #[serde(default)]
    goals: Vec<String>,
    #[serde(default)]
    preferred_scenarios: Vec<String>,
    #[serde(default)]
    target_accents: Vec<String>,
    #[serde(default)]
    progress_notes: Vec<ProgressNote>,
}

impl Default for LearnerProfileData {
    fn default() -> Self {
        Self {
            current_level: None,
            dimension_levels: HashMap::new(),
            goals: Vec::new(),
            preferred_scenarios: Vec::new(),
            target_accents: Vec::new(),
            progress_notes: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------
// Composed response sent to the frontend: declared fields from the JSON
// file plus observed fields computed live from history.sqlite3.
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnerIssue {
    category: String,
    label: String,
    count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    original: Option<String>,
    suggestion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    explanation: Option<String>,
    timestamp: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationTarget {
    label: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    current_level: Option<CefrLevel>,
    dimension_levels: HashMap<AssessmentCompetency, CefrLevel>,
    goals: Vec<String>,
    preferred_scenarios: Vec<String>,
    target_accents: Vec<String>,
    recurring_issues: Vec<LearnerIssue>,
    active_vocabulary: Vec<VocabularyItem>,
    active_grammar_targets: Vec<LearnerIssue>,
    active_pronunciation_targets: Vec<PronunciationTarget>,
    progress_notes: Vec<ProgressNote>,
}

// ---------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveLearnerProfilePreferencesRequest {
    goals: Vec<String>,
    preferred_scenarios: Vec<String>,
    target_accents: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyAssessmentToLearnerProfileRequest {
    #[serde(default)]
    overall_level: Option<CefrLevel>,
    #[serde(default)]
    dimension_levels: HashMap<AssessmentCompetency, CefrLevel>,
    #[serde(default)]
    priorities: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplySessionToLearnerProfileRequest {
    scenario_label: String,
    #[serde(default)]
    priorities: Vec<String>,
}

// ---------------------------------------------------------------------
// JSON file persistence (same shape as tutor.rs's config file handling)
// ---------------------------------------------------------------------

fn config_path(app_handle: &AppHandle) -> Result<PathBuf, LearnerProfileCommandError> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE_NAME))
        .map_err(|error| {
            LearnerProfileCommandError::new(
                "learner-profile-location-unavailable",
                "The learner profile location is unavailable.",
                error.to_string(),
            )
        })
}

fn read_profile(path: &Path) -> Result<LearnerProfileData, LearnerProfileCommandError> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(LearnerProfileData::default())
        }
        Err(error) => {
            return Err(LearnerProfileCommandError::new(
                "learner-profile-storage-failed",
                "The learner profile could not be read.",
                error.to_string(),
            ))
        }
    };

    serde_json::from_slice::<LearnerProfileData>(&content).map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile file is invalid.",
            error.to_string(),
        )
    })
}

fn write_profile(
    path: &Path,
    data: &LearnerProfileData,
) -> Result<(), LearnerProfileCommandError> {
    let directory = path.parent().ok_or_else(|| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile location is invalid.",
            path.display().to_string(),
        )
    })?;

    fs::create_dir_all(directory).map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile directory could not be created.",
            error.to_string(),
        )
    })?;

    let mut temporary = NamedTempFile::new_in(directory).map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile could not be saved.",
            error.to_string(),
        )
    })?;
    serde_json::to_writer_pretty(&mut temporary, data).map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile could not be serialized.",
            error.to_string(),
        )
    })?;
    temporary.flush().map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile could not be saved.",
            error.to_string(),
        )
    })?;
    temporary.persist(path).map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-storage-failed",
            "The learner profile could not be saved.",
            error.error.to_string(),
        )
    })?;

    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// Observed data, computed live from history.sqlite3
// ---------------------------------------------------------------------

fn category_label(category: &str) -> &str {
    match category {
        "grammar" => "grammar",
        "vocabulary" => "vocabulary choices",
        "naturalness" => "natural phrasing",
        "clarity" => "clarity",
        other => other,
    }
}

fn recurring_issues(conn: &Connection) -> rusqlite::Result<Vec<LearnerIssue>> {
    let counts = history::category_counts(conn, RECENT_CORRECTIONS_WINDOW)?;
    Ok(counts
        .into_iter()
        .filter(|entry| entry.count >= RECURRING_MIN_COUNT)
        .map(|entry| LearnerIssue {
            label: category_label(&entry.category).to_string(),
            category: entry.category,
            count: entry.count,
        })
        .collect())
}

fn active_vocabulary(conn: &Connection) -> rusqlite::Result<Vec<VocabularyItem>> {
    let expressions = history::recent_expressions(conn, RECENT_VOCABULARY_LIMIT)?;
    Ok(expressions
        .into_iter()
        .map(|expression| VocabularyItem {
            original: expression.original,
            suggestion: expression.suggestion,
            explanation: expression.explanation,
            timestamp: expression.timestamp,
        })
        .collect())
}

/// The compact, prompt-ready sentence injected into the tutor's system
/// messages as `learnerContext`. Pure and testable without touching a
/// database or the filesystem.
fn compose_tutor_summary(goals: &[String], issues: &[LearnerIssue]) -> Option<String> {
    let mut parts = Vec::new();

    if !goals.is_empty() {
        parts.push(format!(
            "The learner's stated goal is: {}. Let this shape topic and scenario choices when natural.",
            goals.join("; ")
        ));
    }

    let labels: Vec<&str> = issues
        .iter()
        .take(SUMMARY_MAX_CATEGORIES)
        .map(|issue| issue.label.as_str())
        .collect();
    if !labels.is_empty() {
        let joined = labels.join(" and ");
        parts.push(format!(
            "The learner has recently repeated mistakes involving {joined}. \
             Do not drill these explicitly. When natural, create conversation opportunities \
             where these structures may come up."
        ));
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

pub(crate) async fn build_tutor_summary_for_session(
    app_handle: &AppHandle,
) -> Result<Option<String>, HistoryCommandError> {
    let db_path = history::db_path(app_handle)?;
    let profile_path = config_path(app_handle).map_err(HistoryCommandError::from)?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = history::open_connection(&db_path)?;
        let issues = recurring_issues(&conn).map_err(LearnerProfileCommandError::from)?;
        let profile = read_profile(&profile_path)?;
        Ok::<_, LearnerProfileCommandError>(compose_tutor_summary(&profile.goals, &issues))
    })
    .await
    .map_err(|error| {
        HistoryCommandError::new(
            "history-task-failed",
            "The learning history request could not complete.",
            error.to_string(),
        )
    })?
    .map_err(HistoryCommandError::from)
}

// ---------------------------------------------------------------------
// Pure merge logic (unit-tested directly, independent of AppHandle/IO)
// ---------------------------------------------------------------------

fn normalize_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn apply_preferences(
    mut profile: LearnerProfileData,
    goals: Vec<String>,
    preferred_scenarios: Vec<String>,
    target_accents: Vec<String>,
) -> LearnerProfileData {
    profile.goals = normalize_list(goals);
    profile.preferred_scenarios = normalize_list(preferred_scenarios);
    profile.target_accents = normalize_list(target_accents);
    profile
}

fn push_progress_note(profile: &mut LearnerProfileData, note: ProgressNote) {
    profile.progress_notes.push(note);
    if profile.progress_notes.len() > MAX_PROGRESS_NOTES {
        let overflow = profile.progress_notes.len() - MAX_PROGRESS_NOTES;
        profile.progress_notes.drain(0..overflow);
    }
}

fn apply_assessment(
    mut profile: LearnerProfileData,
    overall_level: Option<CefrLevel>,
    dimension_levels: HashMap<AssessmentCompetency, CefrLevel>,
    priorities: &[String],
    now_ms: i64,
) -> LearnerProfileData {
    if let Some(level) = overall_level {
        profile.current_level = Some(level);
    }
    for (competency, level) in dimension_levels {
        profile.dimension_levels.insert(competency, level);
    }

    let mut text = match overall_level {
        Some(level) => format!(
            "Assessment completed — estimated level {}.",
            cefr_level_str(level)
        ),
        None => "Assessment completed — evidence was insufficient for an overall level.".to_string(),
    };
    if !priorities.is_empty() {
        text.push_str(&format!(" Priorities: {}.", priorities.join("; ")));
    }

    push_progress_note(
        &mut profile,
        ProgressNote {
            text,
            origin: ProgressNoteOrigin::Assessment,
            created_at: now_ms,
        },
    );

    profile
}

fn apply_session(
    mut profile: LearnerProfileData,
    scenario_label: &str,
    priorities: &[String],
    now_ms: i64,
) -> LearnerProfileData {
    let mut text = format!("Completed {scenario_label} session.");
    if !priorities.is_empty() {
        text.push_str(&format!(" Priorities: {}.", priorities.join("; ")));
    }

    push_progress_note(
        &mut profile,
        ProgressNote {
            text,
            origin: ProgressNoteOrigin::Session,
            created_at: now_ms,
        },
    );

    profile
}

// ---------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------

async fn compose_profile_response(
    app_handle: &AppHandle,
) -> Result<LearnerProfileResponse, LearnerProfileCommandError> {
    let db_path = history::db_path(app_handle)?;
    let profile_path = config_path(app_handle)?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = history::open_connection(&db_path)?;
        let profile = read_profile(&profile_path)?;
        let issues = recurring_issues(&conn)?;
        let vocabulary = active_vocabulary(&conn)?;
        let grammar_targets = issues
            .iter()
            .filter(|issue| issue.category == "grammar")
            .cloned()
            .collect();

        Ok(LearnerProfileResponse {
            current_level: profile.current_level,
            dimension_levels: profile.dimension_levels,
            goals: profile.goals,
            preferred_scenarios: profile.preferred_scenarios,
            target_accents: profile.target_accents,
            recurring_issues: issues,
            active_vocabulary: vocabulary,
            active_grammar_targets: grammar_targets,
            active_pronunciation_targets: Vec::new(),
            progress_notes: profile.progress_notes,
        })
    })
    .await
    .map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-task-failed",
            "The learner profile request could not complete.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn get_learner_profile(
    app_handle: AppHandle,
) -> Result<LearnerProfileResponse, LearnerProfileCommandError> {
    compose_profile_response(&app_handle).await
}

#[tauri::command]
pub async fn save_learner_profile_preferences(
    app_handle: AppHandle,
    request: SaveLearnerProfilePreferencesRequest,
) -> Result<LearnerProfileResponse, LearnerProfileCommandError> {
    let profile_path = config_path(&app_handle)?;
    let write_path = profile_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let profile = read_profile(&write_path)?;
        let updated = apply_preferences(
            profile,
            request.goals,
            request.preferred_scenarios,
            request.target_accents,
        );
        write_profile(&write_path, &updated)
    })
    .await
    .map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-task-failed",
            "The learner profile could not be saved.",
            error.to_string(),
        )
    })??;

    compose_profile_response(&app_handle).await
}

#[tauri::command]
pub async fn apply_assessment_to_learner_profile(
    app_handle: AppHandle,
    request: ApplyAssessmentToLearnerProfileRequest,
) -> Result<LearnerProfileResponse, LearnerProfileCommandError> {
    let profile_path = config_path(&app_handle)?;
    let write_path = profile_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let profile = read_profile(&write_path)?;
        let updated = apply_assessment(
            profile,
            request.overall_level,
            request.dimension_levels,
            &request.priorities,
            now_ms(),
        );
        write_profile(&write_path, &updated)
    })
    .await
    .map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-task-failed",
            "The learner profile could not be updated.",
            error.to_string(),
        )
    })??;

    compose_profile_response(&app_handle).await
}

#[tauri::command]
pub async fn apply_session_to_learner_profile(
    app_handle: AppHandle,
    request: ApplySessionToLearnerProfileRequest,
) -> Result<LearnerProfileResponse, LearnerProfileCommandError> {
    let profile_path = config_path(&app_handle)?;
    let write_path = profile_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let profile = read_profile(&write_path)?;
        let updated = apply_session(
            profile,
            &request.scenario_label,
            &request.priorities,
            now_ms(),
        );
        write_profile(&write_path, &updated)
    })
    .await
    .map_err(|error| {
        LearnerProfileCommandError::new(
            "learner-profile-task-failed",
            "The learner profile could not be updated.",
            error.to_string(),
        )
    })??;

    compose_profile_response(&app_handle).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::history::{
        category_counts as history_category_counts, create_session as history_create_session,
        open_connection as history_open_connection, record_turn_pair as history_record_turn_pair,
    };
    use crate::commands::tutor::{
        BetterExpression, CorrectionCategory, CorrectionSeverity, TutorCorrection,
    };
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn scratch_dir() -> TempDir {
        TempDir::new().expect("tempdir must exist")
    }

    #[test]
    fn read_profile_defaults_when_file_is_missing() {
        let directory = scratch_dir();
        let path = directory.path().join("learner_profile.json");

        let profile = read_profile(&path).expect("default profile must read");
        assert_eq!(profile, LearnerProfileData::default());
    }

    #[test]
    fn write_then_read_profile_round_trips() {
        let directory = scratch_dir();
        let path = directory.path().join("learner_profile.json");

        let mut written = LearnerProfileData::default();
        written.current_level = Some(CefrLevel::B2);
        written
            .dimension_levels
            .insert(AssessmentCompetency::Fluency, CefrLevel::B2);
        written.goals = vec!["prepare for software engineering interviews".to_string()];

        write_profile(&path, &written).expect("profile must write");
        let read_back = read_profile(&path).expect("profile must read back");

        assert_eq!(read_back, written);
    }

    #[test]
    fn apply_assessment_only_overwrites_provided_dimensions_and_keeps_prior_level_when_none() {
        let mut profile = LearnerProfileData::default();
        profile.current_level = Some(CefrLevel::B1);
        profile
            .dimension_levels
            .insert(AssessmentCompetency::Fluency, CefrLevel::B1);
        profile
            .dimension_levels
            .insert(AssessmentCompetency::Pronunciation, CefrLevel::A2);

        let mut new_levels = HashMap::new();
        new_levels.insert(AssessmentCompetency::Fluency, CefrLevel::B2);

        let updated = apply_assessment(profile, None, new_levels, &[], 1_000);

        // overall_level was None: the prior estimate must survive untouched.
        assert_eq!(updated.current_level, Some(CefrLevel::B1));
        assert_eq!(
            updated.dimension_levels.get(&AssessmentCompetency::Fluency),
            Some(&CefrLevel::B2)
        );
        // Pronunciation wasn't in the new map: it must be preserved, not dropped.
        assert_eq!(
            updated
                .dimension_levels
                .get(&AssessmentCompetency::Pronunciation),
            Some(&CefrLevel::A2)
        );
        assert_eq!(updated.progress_notes.len(), 1);
        assert_eq!(updated.progress_notes[0].origin, ProgressNoteOrigin::Assessment);
    }

    #[test]
    fn apply_assessment_overwrites_current_level_when_present() {
        let mut profile = LearnerProfileData::default();
        profile.current_level = Some(CefrLevel::B1);

        let updated = apply_assessment(
            profile,
            Some(CefrLevel::B2),
            HashMap::new(),
            &["past tense accuracy".to_string()],
            2_000,
        );

        assert_eq!(updated.current_level, Some(CefrLevel::B2));
        assert!(updated.progress_notes[0].text.contains("B2"));
        assert!(updated.progress_notes[0].text.contains("past tense accuracy"));
    }

    #[test]
    fn apply_session_pushes_a_session_origin_note_without_touching_levels() {
        let mut profile = LearnerProfileData::default();
        profile.current_level = Some(CefrLevel::B1);
        profile
            .dimension_levels
            .insert(AssessmentCompetency::Fluency, CefrLevel::B1);

        let updated = apply_session(
            profile,
            "Daily standup",
            &["past tense accuracy".to_string()],
            3_000,
        );

        // A session update never touches CEFR levels — that's assessment-owned.
        assert_eq!(updated.current_level, Some(CefrLevel::B1));
        assert_eq!(
            updated.dimension_levels.get(&AssessmentCompetency::Fluency),
            Some(&CefrLevel::B1)
        );
        assert_eq!(updated.progress_notes.len(), 1);
        assert_eq!(updated.progress_notes[0].origin, ProgressNoteOrigin::Session);
        assert!(updated.progress_notes[0].text.contains("Daily standup"));
        assert!(updated.progress_notes[0].text.contains("past tense accuracy"));
    }

    #[test]
    fn apply_session_omits_priorities_sentence_when_none_given() {
        let profile = LearnerProfileData::default();
        let updated = apply_session(profile, "Restaurant", &[], 4_000);

        assert!(updated.progress_notes[0].text.contains("Restaurant"));
        assert!(!updated.progress_notes[0].text.contains("Priorities"));
    }

    #[test]
    fn progress_notes_are_capped_and_drop_the_oldest() {
        let mut profile = LearnerProfileData::default();
        for index in 0..MAX_PROGRESS_NOTES {
            profile = apply_assessment(profile, None, HashMap::new(), &[], index as i64);
        }
        assert_eq!(profile.progress_notes.len(), MAX_PROGRESS_NOTES);

        profile = apply_assessment(
            profile,
            None,
            HashMap::new(),
            &[],
            MAX_PROGRESS_NOTES as i64,
        );

        assert_eq!(profile.progress_notes.len(), MAX_PROGRESS_NOTES);
        assert_eq!(
            profile.progress_notes.last().unwrap().created_at,
            MAX_PROGRESS_NOTES as i64
        );
        assert_eq!(profile.progress_notes.first().unwrap().created_at, 1);
    }

    #[test]
    fn apply_preferences_trims_and_drops_blank_entries() {
        let profile = LearnerProfileData::default();
        let updated = apply_preferences(
            profile,
            vec!["  prepare for interviews  ".to_string(), "   ".to_string()],
            vec!["software engineering".to_string()],
            vec!["".to_string()],
        );

        assert_eq!(updated.goals, vec!["prepare for interviews".to_string()]);
        assert_eq!(
            updated.preferred_scenarios,
            vec!["software engineering".to_string()]
        );
        assert!(updated.target_accents.is_empty());
    }

    #[test]
    fn compose_tutor_summary_combines_goals_and_recurring_issues() {
        let goals = vec!["prepare for software engineering interviews".to_string()];
        let issues = vec![LearnerIssue {
            category: "grammar".to_string(),
            label: "grammar".to_string(),
            count: 3,
        }];

        let summary = compose_tutor_summary(&goals, &issues).expect("summary must be present");
        assert!(summary.contains("software engineering interviews"));
        assert!(summary.contains("grammar"));
    }

    #[test]
    fn compose_tutor_summary_is_none_when_nothing_to_say() {
        assert_eq!(compose_tutor_summary(&[], &[]), None);
    }

    fn seeded_db_path(directory: &TempDir) -> PathBuf {
        directory.path().join("history.sqlite3")
    }

    fn correction(category: CorrectionCategory) -> TutorCorrection {
        TutorCorrection {
            original: "since many years".into(),
            correction: "for many years".into(),
            explanation: "Use for with a duration.".into(),
            category,
            severity: CorrectionSeverity::Important,
        }
    }

    #[test]
    fn recurring_issues_reads_from_history_and_active_vocabulary_from_expressions() {
        let directory = scratch_dir();
        let path = seeded_db_path(&directory);
        let mut conn = history_open_connection(&path).expect("connection must open");
        let session_id = history_create_session(&conn, 1_000, None, None, None, None).expect("session must create");

        history_record_turn_pair(
            &mut conn,
            session_id,
            "text",
            "reply",
            &[
                correction(CorrectionCategory::Grammar),
                correction(CorrectionCategory::Grammar),
            ],
            &[BetterExpression {
                original: Some("I am agree".into()),
                suggestion: "I agree.".into(),
                explanation: Some("More natural phrasing.".into()),
            }],
            2_000,
        )
        .expect("turn pair must record");

        let issues = recurring_issues(&conn).expect("issues must compute");
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].category, "grammar");
        assert_eq!(issues[0].count, 2);

        let vocabulary = active_vocabulary(&conn).expect("vocabulary must compute");
        assert_eq!(vocabulary.len(), 1);
        assert_eq!(vocabulary[0].suggestion, "I agree.");

        // category_counts itself stays available for other call sites (history.rs tests).
        let _ = history_category_counts(&conn, RECENT_CORRECTIONS_WINDOW)
            .expect("category counts must still be reachable");
    }
}
