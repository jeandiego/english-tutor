use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::history::{self, HistoryCommandError};

// ---------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PronunciationTargetSource {
    RepairEvent,
    SessionSummary,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PronunciationProblemCategory {
    WordStress,
    FinalConsonants,
    VowelContrast,
    ConnectedSpeech,
    Rhythm,
    SpecificWord,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiffOpKind {
    Match,
    Omitted,
    Inserted,
    Substituted,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WordDiffOp {
    pub(crate) op: DiffOpKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) expected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) heard: Option<String>,
}

// ---------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationTarget {
    pub(crate) id: i64,
    pub(crate) phrase: String,
    pub(crate) source: PronunciationTargetSource,
    pub(crate) created_at: i64,
    pub(crate) attempt_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_attempt_at: Option<i64>,
    pub(crate) is_promoted: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationAttemptResult {
    pub(crate) attempt_id: i64,
    pub(crate) is_match: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) category: Option<PronunciationProblemCategory>,
    pub(crate) diff: Vec<WordDiffOp>,
    pub(crate) hint: String,
    pub(crate) promoted: bool,
}

// ---------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitPronunciationAttemptRequest {
    pronunciation_target_id: i64,
    transcript: String,
    #[serde(default)]
    session_id: Option<i64>,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl PronunciationCommandError {
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

impl From<HistoryCommandError> for PronunciationCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for PronunciationCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// Pure analysis core — no DB/IO, unit-tested directly
// ---------------------------------------------------------------------

const CONNECTED_SPEECH_WORDS: &[&str] = &[
    "a", "an", "the", "to", "of", "and", "is", "was", "are", "were", "in", "on", "at", "'s",
    "'re", "'ll", "'d", "'ve", "'m",
];

pub(crate) fn normalize_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'')
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

/// Word-level Wagner–Fischer edit distance with backtrace. Phrases here are
/// short (a sentence or two), so the O(n*m) table is negligible.
pub(crate) fn align_words(expected: &[String], heard: &[String]) -> Vec<WordDiffOp> {
    let n = expected.len();
    let m = heard.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in dp.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in dp[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            dp[i][j] = if expected[i - 1] == heard[j - 1] {
                dp[i - 1][j - 1]
            } else {
                1 + dp[i - 1][j - 1].min(dp[i - 1][j]).min(dp[i][j - 1])
            };
        }
    }

    let mut ops = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && expected[i - 1] == heard[j - 1] {
            ops.push(WordDiffOp {
                op: DiffOpKind::Match,
                expected: Some(expected[i - 1].clone()),
                heard: Some(heard[j - 1].clone()),
            });
            i -= 1;
            j -= 1;
        } else if i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + 1 {
            ops.push(WordDiffOp {
                op: DiffOpKind::Substituted,
                expected: Some(expected[i - 1].clone()),
                heard: Some(heard[j - 1].clone()),
            });
            i -= 1;
            j -= 1;
        } else if i > 0 && dp[i][j] == dp[i - 1][j] + 1 {
            ops.push(WordDiffOp {
                op: DiffOpKind::Omitted,
                expected: Some(expected[i - 1].clone()),
                heard: None,
            });
            i -= 1;
        } else {
            ops.push(WordDiffOp {
                op: DiffOpKind::Inserted,
                expected: None,
                heard: Some(heard[j - 1].clone()),
            });
            j -= 1;
        }
    }
    ops.reverse();
    ops
}

fn consonant_skeleton(word: &str) -> String {
    word.chars().filter(|c| !"aeiou".contains(*c)).collect()
}

fn is_final_consonant_drop(expected: &str, heard: &str) -> bool {
    !heard.is_empty()
        && expected.starts_with(heard)
        && heard.len() < expected.len()
        && expected.len() - heard.len() <= 2
}

fn is_vowel_only_difference(expected: &str, heard: &str) -> bool {
    let expected_skeleton = consonant_skeleton(expected);
    expected != heard
        && !expected_skeleton.is_empty()
        && expected_skeleton == consonant_skeleton(heard)
}

fn vowel_group_count(word: &str) -> usize {
    let mut count = 0;
    let mut in_group = false;
    for c in word.chars() {
        let is_vowel = "aeiou".contains(c);
        if is_vowel && !in_group {
            count += 1;
        }
        in_group = is_vowel;
    }
    count
}

fn is_polysyllabic(word: &str) -> bool {
    vowel_group_count(word) >= 3
}

/// Ordered heuristic ruleset — a deliberately simple, text-only stand-in for
/// phonetic analysis (see the slice's non-goals: no IPA, no promise of
/// perfect phonetic accuracy). Rules are tried most-confident first.
pub(crate) fn classify_problem(diff: &[WordDiffOp]) -> Option<PronunciationProblemCategory> {
    let issues: Vec<&WordDiffOp> = diff.iter().filter(|op| op.op != DiffOpKind::Match).collect();
    if issues.is_empty() {
        return None;
    }

    if issues.len() > 1 {
        return Some(PronunciationProblemCategory::Rhythm);
    }

    let issue = issues[0];
    match issue.op {
        DiffOpKind::Substituted => {
            let expected = issue.expected.as_deref().unwrap_or_default();
            let heard = issue.heard.as_deref().unwrap_or_default();
            if is_final_consonant_drop(expected, heard) {
                Some(PronunciationProblemCategory::FinalConsonants)
            } else if is_vowel_only_difference(expected, heard) {
                Some(PronunciationProblemCategory::VowelContrast)
            } else if is_polysyllabic(expected) {
                Some(PronunciationProblemCategory::WordStress)
            } else {
                Some(PronunciationProblemCategory::SpecificWord)
            }
        }
        DiffOpKind::Omitted => {
            let word = issue.expected.as_deref().unwrap_or_default();
            if CONNECTED_SPEECH_WORDS.contains(&word) {
                Some(PronunciationProblemCategory::ConnectedSpeech)
            } else {
                Some(PronunciationProblemCategory::Rhythm)
            }
        }
        DiffOpKind::Inserted => Some(PronunciationProblemCategory::Rhythm),
        DiffOpKind::Match => unreachable!("issues excludes Match ops"),
    }
}

fn expected_phrase(diff: &[WordDiffOp]) -> String {
    diff.iter()
        .filter_map(|op| op.expected.clone())
        .collect::<Vec<_>>()
        .join(" ")
}

/// One short, practical hint per attempt — a canned template per category,
/// filled with the specific word(s) involved. Deterministic and offline by
/// design: no LLM round-trip in the tight record-hint-retry loop.
pub(crate) fn hint_for(category: Option<PronunciationProblemCategory>, diff: &[WordDiffOp]) -> String {
    let issue = diff.iter().find(|op| op.op != DiffOpKind::Match);
    match category {
        None => "Nice and clear — try it once more at natural speed.".to_string(),
        Some(PronunciationProblemCategory::FinalConsonants) => {
            let word = issue.and_then(|op| op.expected.as_deref()).unwrap_or("that word");
            format!("Try fully pronouncing the ending of \"{word}\" — don't drop the final sound.")
        }
        Some(PronunciationProblemCategory::VowelContrast) => {
            let expected = issue
                .and_then(|op| op.expected.as_deref())
                .unwrap_or("the target word");
            let heard = issue.and_then(|op| op.heard.as_deref()).unwrap_or("what you said");
            format!("Listen for the vowel sound in \"{expected}\" — it came out closer to \"{heard}\".")
        }
        Some(PronunciationProblemCategory::ConnectedSpeech) => {
            format!(
                "In natural speech, small words like this often link together — try saying the phrase as one smooth unit: \"{}\".",
                expected_phrase(diff)
            )
        }
        Some(PronunciationProblemCategory::Rhythm) => {
            format!(
                "Slow down slightly and give each word its own beat: \"{}\".",
                expected_phrase(diff)
            )
        }
        Some(PronunciationProblemCategory::SpecificWord) => {
            let word = issue.and_then(|op| op.expected.as_deref()).unwrap_or("that word");
            format!("Focus on \"{word}\" — say it slowly on its own a few times, then back in the phrase.")
        }
        Some(PronunciationProblemCategory::WordStress) => {
            let word = issue.and_then(|op| op.expected.as_deref()).unwrap_or("that word");
            format!("Put clear stress on one syllable of \"{word}\" rather than saying it evenly.")
        }
    }
}

// ---------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn list_pronunciation_targets(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<PronunciationTarget>, PronunciationCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(20).clamp(1, 50) as i64;
    tauri::async_runtime::spawn_blocking(
        move || -> Result<Vec<PronunciationTarget>, PronunciationCommandError> {
            let conn = history::open_connection(&path)?;
            Ok(history::list_pronunciation_targets_with_stats(&conn, limit)?)
        },
    )
    .await
    .map_err(|error| {
        PronunciationCommandError::new(
            "pronunciation-task-failed",
            "The pronunciation targets could not be loaded.",
            error.to_string(),
        )
    })?
}

#[tauri::command]
pub async fn submit_pronunciation_attempt(
    app_handle: AppHandle,
    request: SubmitPronunciationAttemptRequest,
) -> Result<PronunciationAttemptResult, PronunciationCommandError> {
    let path = history::db_path(&app_handle)?;
    tauri::async_runtime::spawn_blocking(
        move || -> Result<PronunciationAttemptResult, PronunciationCommandError> {
            let conn = history::open_connection(&path)?;
            let target = history::pronunciation_target_core(&conn, request.pronunciation_target_id)?
                .ok_or_else(|| {
                    PronunciationCommandError::new(
                        "not-found",
                        "That pronunciation target no longer exists.",
                        format!(
                            "pronunciation_target {} not found",
                            request.pronunciation_target_id
                        ),
                    )
                })?;

            let expected = normalize_words(&target.phrase);
            let heard = normalize_words(&request.transcript);
            let diff = align_words(&expected, &heard);
            let category = classify_problem(&diff);
            let is_match = category.is_none();
            let hint = hint_for(category, &diff);

            let created_at = now_ms();
            let diff_json = serde_json::to_string(&diff).map_err(|error| {
                PronunciationCommandError::new(
                    "pronunciation-task-failed",
                    "The attempt could not be saved.",
                    error.to_string(),
                )
            })?;
            let attempt_id = history::insert_pronunciation_attempt(
                &conn,
                request.pronunciation_target_id,
                request.session_id,
                &request.transcript,
                is_match,
                category,
                &diff_json,
                &hint,
                created_at,
            )?;

            // Promote to spaced retrieval only once practice shows this is a
            // real, recurring problem — the first observed mismatch is that
            // signal, not creation itself.
            let mut promoted = false;
            if !is_match && target.review_item_id.is_none() {
                let review_source = match target.source {
                    PronunciationTargetSource::RepairEvent => super::review::ReviewSource::RepairEvent,
                    PronunciationTargetSource::SessionSummary => {
                        super::review::ReviewSource::SessionSummary
                    }
                };
                let review_item_id = history::insert_review_item(
                    &conn,
                    super::review::ReviewItemType::PronunciationTarget,
                    &target.phrase,
                    review_source,
                    target.source_repair_event_id,
                    target.source_session_id,
                    None,
                    Some(request.pronunciation_target_id),
                    None,
                    created_at,
                )?;
                history::set_pronunciation_target_review_item(
                    &conn,
                    request.pronunciation_target_id,
                    review_item_id,
                )?;
                promoted = true;
            }

            Ok(PronunciationAttemptResult {
                attempt_id,
                is_match,
                category,
                diff,
                hint,
                promoted,
            })
        },
    )
    .await
    .map_err(|error| {
        PronunciationCommandError::new(
            "pronunciation-task-failed",
            "The pronunciation attempt could not be saved.",
            error.to_string(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<String> {
        normalize_words(text)
    }

    #[test]
    fn normalize_words_strips_punctuation_and_lowercases() {
        assert_eq!(
            words("Hello, World!"),
            vec!["hello".to_string(), "world".to_string()]
        );
    }

    #[test]
    fn align_words_reports_exact_match() {
        let expected = words("I walked to the store");
        let heard = words("I walked to the store");
        let diff = align_words(&expected, &heard);
        assert!(diff.iter().all(|op| op.op == DiffOpKind::Match));
        assert_eq!(classify_problem(&diff), None);
    }

    #[test]
    fn classify_final_consonant_drop() {
        let expected = words("I walked to the store");
        let heard = words("I walk to the store");
        let diff = align_words(&expected, &heard);
        assert_eq!(
            classify_problem(&diff),
            Some(PronunciationProblemCategory::FinalConsonants)
        );
    }

    #[test]
    fn classify_vowel_contrast() {
        let expected = words("I bought a sheep");
        let heard = words("I bought a ship");
        let diff = align_words(&expected, &heard);
        assert_eq!(
            classify_problem(&diff),
            Some(PronunciationProblemCategory::VowelContrast)
        );
    }

    #[test]
    fn classify_connected_speech_omission() {
        let expected = words("I want to go to the store");
        let heard = words("I want go to the store");
        let diff = align_words(&expected, &heard);
        assert_eq!(
            classify_problem(&diff),
            Some(PronunciationProblemCategory::ConnectedSpeech)
        );
    }

    #[test]
    fn classify_rhythm_for_scattered_omissions() {
        let expected = words("Yesterday I went to the busy market downtown");
        let heard = words("Yesterday went the market downtown");
        let diff = align_words(&expected, &heard);
        assert_eq!(
            classify_problem(&diff),
            Some(PronunciationProblemCategory::Rhythm)
        );
    }

    #[test]
    fn classify_specific_word_for_unrelated_substitution() {
        let expected = words("I really enjoy hiking");
        let heard = words("I really enjoy fishing");
        let diff = align_words(&expected, &heard);
        assert_eq!(
            classify_problem(&diff),
            Some(PronunciationProblemCategory::SpecificWord)
        );
    }

    #[test]
    fn hint_for_no_issue_is_encouraging() {
        let hint = hint_for(None, &[]);
        assert!(hint.contains("Nice and clear"));
    }

    #[test]
    fn hint_for_final_consonants_names_the_word() {
        let expected = words("I walked to the store");
        let heard = words("I walk to the store");
        let diff = align_words(&expected, &heard);
        let hint = hint_for(Some(PronunciationProblemCategory::FinalConsonants), &diff);
        assert!(hint.contains("walked"));
    }
}
