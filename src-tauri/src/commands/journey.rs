use serde::Serialize;
use tauri::AppHandle;

use super::assessment::{self, cefr_level_str, AssessmentCommandError};
use super::history::{self, HistoryCommandError};
use super::reading;
use super::review::ReviewOutcome;
use super::writing::{self, WritingCommandError, WritingTaskStatus, WritingTaskType};

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JourneyCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl JourneyCommandError {
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
}

impl From<HistoryCommandError> for JourneyCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<WritingCommandError> for JourneyCommandError {
    fn from(error: WritingCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<AssessmentCommandError> for JourneyCommandError {
    fn from(error: AssessmentCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for JourneyCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

async fn run_blocking<T, F>(task: F) -> Result<T, JourneyCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, JourneyCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            JourneyCommandError::new(
                "journey-task-failed",
                "Your journey could not be loaded.",
                error.to_string(),
            )
        })?
}

// ---------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JourneyCheckpointKind {
    Conversation,
    Writing,
    Reading,
    Assessment,
    ChunkAttempt,
}

/// One entry on the journey path — a normalized view over whichever
/// activity table it came from, just enough to render a checkpoint marker
/// and a summary sheet. Full detail is fetched on demand per kind (see
/// `JourneyCheckpointSheet` on the frontend) rather than carried here.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JourneyCheckpoint {
    id: String,
    kind: JourneyCheckpointKind,
    ref_id: i64,
    created_at: i64,
    headline: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    needs_review: bool,
}

// ---------------------------------------------------------------------
// Label helpers — small, local, not worth centralizing for one command
// ---------------------------------------------------------------------

fn writing_task_type_label(task_type: WritingTaskType) -> &'static str {
    match task_type {
        WritingTaskType::ProfessionalEmail => "Professional email",
        WritingTaskType::OpinionParagraph => "Opinion paragraph",
        WritingTaskType::TechnicalExplanation => "Technical explanation",
        WritingTaskType::Summary => "Summary",
        WritingTaskType::Recommendation => "Recommendation",
        WritingTaskType::ShortArgument => "Short argument",
    }
}

fn review_outcome_label(outcome: ReviewOutcome) -> &'static str {
    match outcome {
        ReviewOutcome::Remembered => "Remembered",
        ReviewOutcome::PartiallyRemembered => "Partially remembered",
        ReviewOutcome::Missed => "Missed",
        ReviewOutcome::Skipped => "Skipped",
    }
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn list_journey_checkpoints(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JourneyCheckpoint>, JourneyCommandError> {
    let per_kind_limit = limit.unwrap_or(300).clamp(1, 500);

    let sessions = history::list_recent_sessions(app_handle.clone(), Some(per_kind_limit)).await?;
    let writing_tasks = writing::list_writing_tasks(app_handle.clone(), Some(per_kind_limit)).await?;
    let assessments = assessment::list_assessments(app_handle.clone(), Some(per_kind_limit)).await?;

    let path = history::db_path(&app_handle)?;
    let writing_task_ids: Vec<i64> = writing_tasks.iter().map(|task| task.id).collect();
    let (reading_sessions, chunk_attempts, writing_needs_review) = run_blocking(move || {
        let conn = history::open_connection(&path)?;
        let reading_sessions = history::recent_reading_sessions(&conn, per_kind_limit as i64)?;
        let chunk_attempts = history::recent_lexical_chunk_attempts(&conn, per_kind_limit as i64)?;
        let writing_needs_review = writing_task_ids
            .into_iter()
            .map(|id| Ok((id, history::writing_task_has_open_priority_issues(&conn, id)?)))
            .collect::<rusqlite::Result<Vec<(i64, bool)>>>()?;
        Ok::<_, JourneyCommandError>((reading_sessions, chunk_attempts, writing_needs_review))
    })
    .await?;

    let mut checkpoints: Vec<JourneyCheckpoint> = Vec::with_capacity(
        sessions.len() + writing_tasks.len() + assessments.len() + reading_sessions.len() + chunk_attempts.len(),
    );

    for session in sessions {
        checkpoints.push(JourneyCheckpoint {
            id: format!("conversation:{}", session.id),
            kind: JourneyCheckpointKind::Conversation,
            ref_id: session.id,
            created_at: session.started_at,
            headline: session.topic.or(session.mode).unwrap_or_else(|| "Conversation".to_string()),
            detail: Some(format!("{} turns", session.turn_count)),
            needs_review: false,
        });
    }

    for task in writing_tasks {
        let needs_review = writing_needs_review
            .iter()
            .find(|(id, _)| *id == task.id)
            .map(|(_, flag)| *flag)
            .unwrap_or(false);
        let detail = match (task.status, task.rewrite_overall_level.or(task.draft_overall_level)) {
            (WritingTaskStatus::Drafting, _) => Some("In progress".to_string()),
            (_, Some(level)) => Some(cefr_level_str(level).to_string()),
            (_, None) => None,
        };
        checkpoints.push(JourneyCheckpoint {
            id: format!("writing:{}", task.id),
            kind: JourneyCheckpointKind::Writing,
            ref_id: task.id,
            created_at: task.created_at,
            headline: writing_task_type_label(task.task_type).to_string(),
            detail,
            needs_review,
        });
    }

    for attempt in reading_sessions {
        let needs_review = attempt
            .summary_fidelity
            .is_some_and(|fidelity| fidelity != reading::SummaryFidelity::Faithful)
            || attempt
                .response_relevance
                .is_some_and(|relevance| relevance != reading::ResponseRelevance::Relevant);
        checkpoints.push(JourneyCheckpoint {
            id: format!("reading:{}", attempt.id),
            kind: JourneyCheckpointKind::Reading,
            ref_id: attempt.id,
            created_at: attempt.created_at,
            headline: "Reading to writing".to_string(),
            detail: Some(attempt.text_id),
            needs_review,
        });
    }

    for assessment_summary in assessments {
        let detail = assessment_summary
            .estimated_level
            .map(|level| cefr_level_str(level).to_string());
        checkpoints.push(JourneyCheckpoint {
            id: format!("assessment:{}", assessment_summary.id),
            kind: JourneyCheckpointKind::Assessment,
            ref_id: assessment_summary.id,
            created_at: assessment_summary.started_at,
            headline: "Level check".to_string(),
            detail,
            needs_review: false,
        });
    }

    for attempt in chunk_attempts {
        let needs_review = matches!(attempt.outcome, ReviewOutcome::Missed | ReviewOutcome::Skipped);
        checkpoints.push(JourneyCheckpoint {
            id: format!("chunk_attempt:{}", attempt.id),
            kind: JourneyCheckpointKind::ChunkAttempt,
            ref_id: attempt.id,
            created_at: attempt.created_at,
            headline: attempt.chunk_text,
            detail: Some(review_outcome_label(attempt.outcome).to_string()),
            needs_review,
        });
    }

    checkpoints.sort_by_key(|checkpoint| checkpoint.created_at);
    Ok(checkpoints)
}
