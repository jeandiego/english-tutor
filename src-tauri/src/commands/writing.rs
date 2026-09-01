use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::assessment::{cefr_level_str, CefrLevel};
use super::history::{self, HistoryCommandError};
use super::learner_profile::{self, ApplyWritingTaskToLearnerProfileRequest};
use super::review::{ReviewItemType, ReviewSource};
use super::tutor::{self, OllamaRequestMessage, TutorCommandError, TutorPerformance};

const WRITING_EVALUATOR_SYSTEM_INSTRUCTION: &str = r#"You are an English writing evaluator for a dedicated writing-practice mode. You do not converse with the learner. Your only job is to judge one piece of writing against a fixed task and rubric, and return a structured, evidence-grounded evaluation.

You will be given: the task's communicative goal, target CEFR level, suggested word range, success criteria, a rubric, recommended chunks for this task type, and the learner's submitted text (either their first draft, or a rewrite of an earlier draft).

Score five dimensions, each as one CEFR level from B1, B2, or C1 (never use A1, A2, or C2 — this evaluator is calibrated for the B1-to-C1 range only):
- taskAchievement: how fully and appropriately the text fulfills the task's communicative goal and success criteria.
- coherenceCohesion: how clearly ideas are organized and linked (paragraphing, linking devices, logical flow).
- lexicalResource: range, precision, and naturalness of vocabulary and collocations.
- grammar: range and accuracy of grammatical structures.
- registerTone: appropriateness of formality and tone for the task's context.

For each dimension, give a short evidence quote or paraphrase from the actual text — never a generic statement.

Then select 1 to 3 priority issues — the most important problems to fix, not every problem. Prioritize clarity, cohesion, and natural collocations over rare vocabulary. For each: pick the dimension it belongs to as its category, quote the exact original phrase, give a corrected or more natural version, and briefly explain why. Never return more than 3.

Then list 1 to 4 useful chunks: natural collocations or phrases the learner could adopt for this kind of task, each with its register (for example "professional", "neutral", "conversational") and one example sentence using it.

Finally write a rewriteInstruction: one or two sentences telling the learner what to focus on when they rewrite — grounded in the priority issues you just gave, not generic advice.

Never invent evidence. Judge only the English demonstrated in the text given.

Always return exactly this JSON object shape, using these exact field names:
{
  "overallLevel": "B2",
  "dimensions": {
    "taskAchievement": { "level": "B2", "evidence": "..." },
    "coherenceCohesion": { "level": "B1", "evidence": "..." },
    "lexicalResource": { "level": "B1", "evidence": "..." },
    "grammar": { "level": "B2", "evidence": "..." },
    "registerTone": { "level": "B2", "evidence": "..." }
  },
  "priorityIssues": [
    { "category": "lexicalResource", "original": "I have much experience", "suggested": "I have extensive experience", "explanation": "..." }
  ],
  "usefulChunks": [
    { "chunk": "I have extensive experience with...", "register": "professional", "example": "I have extensive experience with React and TypeScript." }
  ],
  "rewriteInstruction": "..."
}"#;

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl WritingCommandError {
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

impl From<TutorCommandError> for WritingCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<HistoryCommandError> for WritingCommandError {
    fn from(error: HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<rusqlite::Error> for WritingCommandError {
    fn from(error: rusqlite::Error) -> Self {
        HistoryCommandError::from(error).into()
    }
}

fn required_text(value: String, field: &str) -> Result<String, WritingCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(WritingCommandError::new(
            "invalid-response",
            "The writing evaluator returned an invalid structured response.",
            format!("The {field} field was empty."),
        ));
    }
    Ok(normalized)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

async fn run_blocking<T, F>(task: F) -> Result<T, WritingCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WritingCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            WritingCommandError::new(
                "writing-task-failed",
                "The writing gym request could not complete.",
                error.to_string(),
            )
        })?
}

// ---------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum WritingTaskType {
    ProfessionalEmail,
    OpinionParagraph,
    TechnicalExplanation,
    Summary,
    Recommendation,
    ShortArgument,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum WritingDimension {
    TaskAchievement,
    CoherenceCohesion,
    LexicalResource,
    Grammar,
    RegisterTone,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WritingEvaluationStage {
    Draft,
    Rewrite,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WritingTaskStatus {
    Drafting,
    DraftEvaluated,
    RewriteEvaluated,
}

/// Collapses a writing dimension onto the existing review-item type space —
/// no new review types are introduced, writing signal just adds to the same
/// buckets correction, repair, and assessment signal already feed. Mirrors
/// `review::review_type_from_repair_priority`.
fn review_type_from_writing_dimension(dimension: WritingDimension) -> ReviewItemType {
    match dimension {
        WritingDimension::LexicalResource => ReviewItemType::Vocabulary,
        WritingDimension::Grammar => ReviewItemType::GrammarPattern,
        WritingDimension::RegisterTone => ReviewItemType::Phrase,
        WritingDimension::TaskAchievement | WritingDimension::CoherenceCohesion => {
            ReviewItemType::ConversationStrategy
        }
    }
}

// ---------------------------------------------------------------------
// Static task blueprint — single source of truth (the evaluator prompt
// needs the rubric/success-criteria text server-side, so this is not
// duplicated as a separate TS-only catalog).
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingTaskBlueprint {
    task_type: WritingTaskType,
    label: &'static str,
    communicative_goal: &'static str,
    target_level: CefrLevel,
    suggested_word_min: u32,
    suggested_word_max: u32,
    success_criteria: Vec<&'static str>,
    recommended_chunks: Vec<&'static str>,
    rubric: &'static str,
}

pub(crate) fn task_blueprints() -> Vec<WritingTaskBlueprint> {
    vec![
        WritingTaskBlueprint {
            task_type: WritingTaskType::ProfessionalEmail,
            label: "Professional email",
            communicative_goal: "Request, inform, or follow up in a workplace context.",
            target_level: CefrLevel::B2,
            suggested_word_min: 80,
            suggested_word_max: 150,
            success_criteria: vec![
                "States the purpose clearly in the first line",
                "Uses an appropriate greeting and sign-off",
                "Keeps a polite but direct professional register",
            ],
            recommended_chunks: vec![
                "I'm writing to...",
                "I would appreciate it if...",
                "Please let me know if...",
            ],
            rubric: "Professional register, clear greeting/body/call-to-action/sign-off structure, no overly casual phrasing.",
        },
        WritingTaskBlueprint {
            task_type: WritingTaskType::OpinionParagraph,
            label: "Opinion paragraph",
            communicative_goal: "State and support an opinion on a given topic.",
            target_level: CefrLevel::B2,
            suggested_word_min: 100,
            suggested_word_max: 180,
            success_criteria: vec![
                "States a clear stance in the first sentence",
                "Gives at least two supporting reasons",
                "Optionally addresses a counterpoint",
            ],
            recommended_chunks: vec![
                "In my opinion...",
                "One reason for this is...",
                "This is particularly true when...",
            ],
            rubric: "Coherence via a clear topic sentence and linking devices, natural collocations, opinion supported rather than merely stated.",
        },
        WritingTaskBlueprint {
            task_type: WritingTaskType::TechnicalExplanation,
            label: "Technical explanation",
            communicative_goal: "Explain a technical concept to a non-expert.",
            target_level: CefrLevel::B2,
            suggested_word_min: 120,
            suggested_word_max: 200,
            success_criteria: vec![
                "Defines the concept in simple terms before elaborating",
                "Uses an analogy or concrete example",
                "Avoids unexplained jargon",
            ],
            recommended_chunks: vec![
                "In simple terms...",
                "This works by...",
                "A useful way to think about this is...",
            ],
            rubric: "Clarity and accurate register (not overly academic, not sloppy), logical sequencing from simple to detailed.",
        },
        WritingTaskBlueprint {
            task_type: WritingTaskType::Summary,
            label: "Summary",
            communicative_goal: "Summarize a short text or idea accurately and concisely.",
            target_level: CefrLevel::B2,
            suggested_word_min: 60,
            suggested_word_max: 120,
            success_criteria: vec![
                "Captures the main point plus two supporting points",
                "Adds no personal opinion",
                "Stays concise without redundancy",
            ],
            recommended_chunks: vec![
                "The text argues that...",
                "According to the passage...",
                "Overall, the main point is...",
            ],
            rubric: "Fidelity to the source, conciseness, no redundant restatement.",
        },
        WritingTaskBlueprint {
            task_type: WritingTaskType::Recommendation,
            label: "Recommendation",
            communicative_goal: "Recommend a course of action with justification.",
            target_level: CefrLevel::C1,
            suggested_word_min: 100,
            suggested_word_max: 180,
            success_criteria: vec![
                "States a clear recommendation",
                "Gives at least two justifications",
                "Addresses a possible objection",
            ],
            recommended_chunks: vec![
                "I would recommend...",
                "This makes sense because...",
                "Although it might seem..., in fact...",
            ],
            rubric: "Persuasive structure, hedging and register appropriate for a professional audience.",
        },
        WritingTaskBlueprint {
            task_type: WritingTaskType::ShortArgument,
            label: "Short argument with counterpoint",
            communicative_goal: "Make a short argument that acknowledges and rebuts a counterpoint.",
            target_level: CefrLevel::C1,
            suggested_word_min: 150,
            suggested_word_max: 220,
            success_criteria: vec![
                "States a clear thesis",
                "Acknowledges at least one counterpoint",
                "Rebuts the counterpoint rather than ignoring it",
            ],
            recommended_chunks: vec![
                "While it's true that..., it's also worth considering...",
                "This argument overlooks...",
                "On balance,...",
            ],
            rubric: "Argumentative structure, discourse markers, nuance and hedging appropriate to C1 register.",
        },
    ]
}

fn find_blueprint(task_type: WritingTaskType) -> WritingTaskBlueprint {
    task_blueprints()
        .into_iter()
        .find(|blueprint| blueprint.task_type == task_type)
        .expect("every WritingTaskType must have a blueprint entry")
}

// ---------------------------------------------------------------------
// Evaluation records — the shape shared between the LLM response, SQL
// persistence, and the response sent back to the frontend.
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DimensionScoreRecord {
    pub(crate) dimension: WritingDimension,
    pub(crate) level: CefrLevel,
    pub(crate) evidence: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PriorityIssueRecord {
    pub(crate) category: WritingDimension,
    pub(crate) original: String,
    pub(crate) suggested: String,
    pub(crate) explanation: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsefulChunkRecord {
    pub(crate) chunk: String,
    pub(crate) register: String,
    pub(crate) example: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WritingEvaluationRecord {
    pub(crate) overall_level: CefrLevel,
    pub(crate) rewrite_instruction: String,
    pub(crate) dimensions: Vec<DimensionScoreRecord>,
    pub(crate) priority_issues: Vec<PriorityIssueRecord>,
    pub(crate) useful_chunks: Vec<UsefulChunkRecord>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingEvaluationResult {
    id: i64,
    stage: WritingEvaluationStage,
    #[serde(flatten)]
    evaluation: WritingEvaluationRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

pub(crate) fn evaluation_result_from_record(
    id: i64,
    stage: WritingEvaluationStage,
    evaluation: WritingEvaluationRecord,
    performance: Option<TutorPerformance>,
) -> WritingEvaluationResult {
    WritingEvaluationResult {
        id,
        stage,
        evaluation,
        performance,
    }
}

/// Maps the draft evaluation's priority issues and useful chunks onto
/// review-item drafts — this is what the rewrite is supposed to have
/// incorporated, mirroring how the session-summary flow's LLM-authored
/// `reviewItems` become `ReviewItemDraft`s (see `review::ReviewItemDraft`).
fn review_drafts_from_evaluation(record: &WritingEvaluationRecord) -> Vec<(ReviewItemType, String)> {
    let mut drafts = Vec::new();
    for issue in &record.priority_issues {
        drafts.push((
            review_type_from_writing_dimension(issue.category),
            format!(
                "{} — say \"{}\" instead of \"{}\"",
                issue.explanation, issue.suggested, issue.original
            ),
        ));
    }
    for chunk in &record.useful_chunks {
        drafts.push((
            ReviewItemType::Phrase,
            format!("{} (e.g. \"{}\")", chunk.chunk, chunk.example),
        ));
    }
    drafts
}

// ---------------------------------------------------------------------
// Evaluator — LLM call
// ---------------------------------------------------------------------

fn dimension_result_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "level": { "type": "string", "enum": ["B1", "B2", "C1"] },
            "evidence": { "type": "string", "minLength": 1 }
        },
        "required": ["level", "evidence"]
    })
}

fn writing_evaluation_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "overallLevel": { "type": "string", "enum": ["B1", "B2", "C1"] },
            "dimensions": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "taskAchievement": dimension_result_schema(),
                    "coherenceCohesion": dimension_result_schema(),
                    "lexicalResource": dimension_result_schema(),
                    "grammar": dimension_result_schema(),
                    "registerTone": dimension_result_schema()
                },
                "required": ["taskAchievement", "coherenceCohesion", "lexicalResource", "grammar", "registerTone"]
            },
            "priorityIssues": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": ["taskAchievement", "coherenceCohesion", "lexicalResource", "grammar", "registerTone"]
                        },
                        "original": { "type": "string", "minLength": 1 },
                        "suggested": { "type": "string", "minLength": 1 },
                        "explanation": { "type": "string", "minLength": 1 }
                    },
                    "required": ["category", "original", "suggested", "explanation"]
                }
            },
            "usefulChunks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "chunk": { "type": "string", "minLength": 1 },
                        "register": { "type": "string", "minLength": 1 },
                        "example": { "type": "string", "minLength": 1 }
                    },
                    "required": ["chunk", "register", "example"]
                }
            },
            "rewriteInstruction": { "type": "string", "minLength": 1 }
        },
        "required": ["overallLevel", "dimensions", "priorityIssues", "usefulChunks", "rewriteInstruction"]
    })
}

fn writing_evaluation_messages(
    blueprint: &WritingTaskBlueprint,
    stage: WritingEvaluationStage,
    text: &str,
) -> Vec<OllamaRequestMessage> {
    let stage_note = match stage {
        WritingEvaluationStage::Draft => "This is the learner's first draft for this task.",
        WritingEvaluationStage::Rewrite => {
            "This is the learner's rewrite after receiving feedback on an earlier draft. Evaluate it fresh, on its own merits."
        }
    };
    let user_content = format!(
        "Task: {}\nCommunicative goal: {}\nTarget level: {}\nSuggested length: {}-{} words\nSuccess criteria: {}\nRubric: {}\nRecommended chunks for this task type: {}\n\n{}\n\nLearner's text:\n{}",
        blueprint.label,
        blueprint.communicative_goal,
        cefr_level_str(blueprint.target_level),
        blueprint.suggested_word_min,
        blueprint.suggested_word_max,
        blueprint.success_criteria.join("; "),
        blueprint.rubric,
        blueprint.recommended_chunks.join("; "),
        stage_note,
        text.trim(),
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: WRITING_EVALUATOR_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredDimensionResult {
    level: CefrLevel,
    evidence: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredDimensions {
    task_achievement: StructuredDimensionResult,
    coherence_cohesion: StructuredDimensionResult,
    lexical_resource: StructuredDimensionResult,
    grammar: StructuredDimensionResult,
    register_tone: StructuredDimensionResult,
}

impl StructuredDimensions {
    fn into_records(self) -> Vec<DimensionScoreRecord> {
        vec![
            DimensionScoreRecord {
                dimension: WritingDimension::TaskAchievement,
                level: self.task_achievement.level,
                evidence: self.task_achievement.evidence,
            },
            DimensionScoreRecord {
                dimension: WritingDimension::CoherenceCohesion,
                level: self.coherence_cohesion.level,
                evidence: self.coherence_cohesion.evidence,
            },
            DimensionScoreRecord {
                dimension: WritingDimension::LexicalResource,
                level: self.lexical_resource.level,
                evidence: self.lexical_resource.evidence,
            },
            DimensionScoreRecord {
                dimension: WritingDimension::Grammar,
                level: self.grammar.level,
                evidence: self.grammar.evidence,
            },
            DimensionScoreRecord {
                dimension: WritingDimension::RegisterTone,
                level: self.register_tone.level,
                evidence: self.register_tone.evidence,
            },
        ]
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredPriorityIssue {
    category: WritingDimension,
    original: String,
    suggested: String,
    explanation: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredUsefulChunk {
    chunk: String,
    register: String,
    example: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredWritingEvaluation {
    overall_level: CefrLevel,
    dimensions: StructuredDimensions,
    priority_issues: Vec<StructuredPriorityIssue>,
    useful_chunks: Vec<StructuredUsefulChunk>,
    rewrite_instruction: String,
}

impl StructuredWritingEvaluation {
    fn validated(mut self) -> Result<Self, WritingCommandError> {
        if self.priority_issues.is_empty() || self.priority_issues.len() > 3 {
            return Err(WritingCommandError::new(
                "invalid-response",
                "The writing evaluator did not return between 1 and 3 priority issues.",
                format!("priorityIssues length: {}", self.priority_issues.len()),
            ));
        }
        if self.useful_chunks.is_empty() {
            return Err(WritingCommandError::new(
                "invalid-response",
                "The writing evaluator did not return any useful chunks.",
                "usefulChunks was empty",
            ));
        }

        self.dimensions.task_achievement.evidence = required_text(
            self.dimensions.task_achievement.evidence,
            "dimensions.taskAchievement.evidence",
        )?;
        self.dimensions.coherence_cohesion.evidence = required_text(
            self.dimensions.coherence_cohesion.evidence,
            "dimensions.coherenceCohesion.evidence",
        )?;
        self.dimensions.lexical_resource.evidence = required_text(
            self.dimensions.lexical_resource.evidence,
            "dimensions.lexicalResource.evidence",
        )?;
        self.dimensions.grammar.evidence =
            required_text(self.dimensions.grammar.evidence, "dimensions.grammar.evidence")?;
        self.dimensions.register_tone.evidence = required_text(
            self.dimensions.register_tone.evidence,
            "dimensions.registerTone.evidence",
        )?;

        for (index, issue) in self.priority_issues.iter_mut().enumerate() {
            issue.original = required_text(
                std::mem::take(&mut issue.original),
                &format!("priorityIssues[{index}].original"),
            )?;
            issue.suggested = required_text(
                std::mem::take(&mut issue.suggested),
                &format!("priorityIssues[{index}].suggested"),
            )?;
            issue.explanation = required_text(
                std::mem::take(&mut issue.explanation),
                &format!("priorityIssues[{index}].explanation"),
            )?;
        }
        for (index, chunk) in self.useful_chunks.iter_mut().enumerate() {
            chunk.chunk = required_text(
                std::mem::take(&mut chunk.chunk),
                &format!("usefulChunks[{index}].chunk"),
            )?;
            chunk.register = required_text(
                std::mem::take(&mut chunk.register),
                &format!("usefulChunks[{index}].register"),
            )?;
            chunk.example = required_text(
                std::mem::take(&mut chunk.example),
                &format!("usefulChunks[{index}].example"),
            )?;
        }
        self.rewrite_instruction = required_text(self.rewrite_instruction, "rewriteInstruction")?;

        Ok(self)
    }
}

impl From<StructuredWritingEvaluation> for WritingEvaluationRecord {
    fn from(value: StructuredWritingEvaluation) -> Self {
        Self {
            overall_level: value.overall_level,
            rewrite_instruction: value.rewrite_instruction,
            dimensions: value.dimensions.into_records(),
            priority_issues: value
                .priority_issues
                .into_iter()
                .map(|issue| PriorityIssueRecord {
                    category: issue.category,
                    original: issue.original,
                    suggested: issue.suggested,
                    explanation: issue.explanation,
                })
                .collect(),
            useful_chunks: value
                .useful_chunks
                .into_iter()
                .map(|chunk| UsefulChunkRecord {
                    chunk: chunk.chunk,
                    register: chunk.register,
                    example: chunk.example,
                })
                .collect(),
        }
    }
}

async fn resolve_writing_settings(
    app_handle: &AppHandle,
) -> Result<tutor::TutorSettings, WritingCommandError> {
    let path = tutor::config_path(app_handle)?;
    Ok(tutor::load_settings(path).await?)
}

async fn evaluate_writing_text(
    app_handle: &AppHandle,
    task_type: WritingTaskType,
    stage: WritingEvaluationStage,
    text: &str,
) -> Result<(WritingEvaluationRecord, Option<TutorPerformance>), WritingCommandError> {
    let settings = resolve_writing_settings(app_handle).await?;
    let blueprint = find_blueprint(task_type);
    let messages = writing_evaluation_messages(&blueprint, stage, text);
    let (content, performance) = tutor::perform_structured_chat(
        &settings,
        tutor::StructuredChatRequest {
            messages,
            schema: writing_evaluation_response_schema(),
            temperature: 0.3,
            think: false,
            request_failed_code: "writing-request-failed",
            timeout_message: "The local tutor took too long to evaluate the writing.",
            failure_message: "The writing evaluation request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredWritingEvaluation>(&content)
        .map_err(|error| {
            WritingCommandError::new(
                "invalid-response",
                "The local tutor returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;
    Ok((parsed.into(), performance))
}

// ---------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingTask {
    id: i64,
    task_type: WritingTaskType,
    target_level: CefrLevel,
    status: WritingTaskStatus,
    created_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingTaskDetail {
    pub(crate) id: i64,
    pub(crate) task_type: WritingTaskType,
    pub(crate) target_level: CefrLevel,
    pub(crate) status: WritingTaskStatus,
    pub(crate) draft_text: Option<String>,
    pub(crate) rewrite_text: Option<String>,
    pub(crate) created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) draft_evaluation: Option<WritingEvaluationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rewrite_evaluation: Option<WritingEvaluationResult>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingTaskSummary {
    pub(crate) id: i64,
    pub(crate) task_type: WritingTaskType,
    pub(crate) status: WritingTaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) draft_overall_level: Option<CefrLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rewrite_overall_level: Option<CefrLevel>,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingComparisonResult {
    draft_evaluation: WritingEvaluationResult,
    rewrite_evaluation: WritingEvaluationResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    learner_profile_warning: Option<String>,
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[tauri::command]
pub fn list_writing_task_types() -> Vec<WritingTaskBlueprint> {
    task_blueprints()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartWritingTaskRequest {
    task_type: WritingTaskType,
}

#[tauri::command]
pub async fn start_writing_task(
    app_handle: AppHandle,
    request: StartWritingTaskRequest,
) -> Result<WritingTask, WritingCommandError> {
    let path = history::db_path(&app_handle)?;
    let blueprint = find_blueprint(request.task_type);
    let task_type = request.task_type;
    let target_level = blueprint.target_level;
    let created_at = now_ms();
    run_blocking(move || -> Result<WritingTask, WritingCommandError> {
        let conn = history::open_connection(&path)?;
        let id = history::insert_writing_task(&conn, task_type, target_level, created_at)?;
        Ok(WritingTask {
            id,
            task_type,
            target_level,
            status: WritingTaskStatus::Drafting,
            created_at,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitWritingDraftRequest {
    writing_task_id: i64,
    task_type: WritingTaskType,
    draft_text: String,
}

#[tauri::command]
pub async fn submit_writing_draft(
    app_handle: AppHandle,
    request: SubmitWritingDraftRequest,
) -> Result<WritingEvaluationResult, WritingCommandError> {
    if request.draft_text.trim().is_empty() {
        return Err(WritingCommandError::new(
            "empty-draft",
            "Write a draft before submitting it for feedback.",
            "draftText was empty",
        ));
    }
    let draft_text = request.draft_text.trim().to_string();

    let (evaluation, performance) = evaluate_writing_text(
        &app_handle,
        request.task_type,
        WritingEvaluationStage::Draft,
        &draft_text,
    )
    .await?;

    let path = history::db_path(&app_handle)?;
    let writing_task_id = request.writing_task_id;
    let now = now_ms();
    let evaluation_for_db = evaluation.clone();
    let evaluation_id = run_blocking(move || -> Result<i64, WritingCommandError> {
        let mut conn = history::open_connection(&path)?;
        Ok(history::record_writing_draft_evaluation(
            &mut conn,
            writing_task_id,
            &draft_text,
            &evaluation_for_db,
            now,
        )?)
    })
    .await?;

    Ok(evaluation_result_from_record(
        evaluation_id,
        WritingEvaluationStage::Draft,
        evaluation,
        performance,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitWritingRewriteRequest {
    writing_task_id: i64,
    task_type: WritingTaskType,
    rewrite_text: String,
}

#[tauri::command]
pub async fn submit_writing_rewrite(
    app_handle: AppHandle,
    request: SubmitWritingRewriteRequest,
) -> Result<WritingComparisonResult, WritingCommandError> {
    if request.rewrite_text.trim().is_empty() {
        return Err(WritingCommandError::new(
            "empty-rewrite",
            "Write a rewrite before submitting it for feedback.",
            "rewriteText was empty",
        ));
    }
    let rewrite_text = request.rewrite_text.trim().to_string();

    let (rewrite_record, performance) = evaluate_writing_text(
        &app_handle,
        request.task_type,
        WritingEvaluationStage::Rewrite,
        &rewrite_text,
    )
    .await?;

    let path = history::db_path(&app_handle)?;
    let writing_task_id = request.writing_task_id;
    let now = now_ms();
    let rewrite_record_for_db = rewrite_record.clone();

    let (rewrite_evaluation_id, draft_evaluation) = run_blocking(
        move || -> Result<(i64, Option<(i64, WritingEvaluationRecord)>), WritingCommandError> {
            let mut conn = history::open_connection(&path)?;
            let rewrite_evaluation_id = history::record_writing_rewrite_evaluation(
                &mut conn,
                writing_task_id,
                &rewrite_text,
                &rewrite_record_for_db,
                now,
            )?;

            let draft_evaluation =
                history::writing_evaluation_by_stage(&conn, writing_task_id, WritingEvaluationStage::Draft)?;

            if let Some((_, draft_record)) = &draft_evaluation {
                for (item_type, content) in review_drafts_from_evaluation(draft_record) {
                    history::insert_review_item(
                        &conn,
                        item_type,
                        &content,
                        ReviewSource::WritingTask,
                        None,
                        None,
                        None,
                        None,
                        Some(writing_task_id),
                        None,
                        now,
                    )?;
                }
            }

            Ok((rewrite_evaluation_id, draft_evaluation))
        },
    )
    .await?;

    let Some((draft_evaluation_id, draft_record)) = draft_evaluation else {
        return Err(WritingCommandError::new(
            "invalid-state",
            "The draft must be evaluated before submitting a rewrite.",
            format!("writing_task_id {writing_task_id} had no draft evaluation"),
        ));
    };

    let blueprint = find_blueprint(request.task_type);
    let learner_profile_warning = match learner_profile::apply_writing_task_to_learner_profile(
        app_handle.clone(),
        ApplyWritingTaskToLearnerProfileRequest {
            task_type_label: blueprint.label.to_string(),
            draft_overall_level: draft_record.overall_level,
            rewrite_overall_level: rewrite_record.overall_level,
        },
    )
    .await
    {
        Ok(_) => None,
        Err(error) => Some(error.into_parts().1),
    };

    Ok(WritingComparisonResult {
        draft_evaluation: evaluation_result_from_record(
            draft_evaluation_id,
            WritingEvaluationStage::Draft,
            draft_record,
            None,
        ),
        rewrite_evaluation: evaluation_result_from_record(
            rewrite_evaluation_id,
            WritingEvaluationStage::Rewrite,
            rewrite_record,
            performance,
        ),
        learner_profile_warning,
    })
}

#[tauri::command]
pub async fn get_writing_task(
    app_handle: AppHandle,
    writing_task_id: i64,
) -> Result<WritingTaskDetail, WritingCommandError> {
    let path = history::db_path(&app_handle)?;
    run_blocking(move || -> Result<WritingTaskDetail, WritingCommandError> {
        let conn = history::open_connection(&path)?;
        history::writing_task_detail(&conn, writing_task_id)?.ok_or_else(|| {
            WritingCommandError::new(
                "not-found",
                "That writing task could not be found.",
                format!("writing_task_id {writing_task_id} not found"),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn list_writing_tasks(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<WritingTaskSummary>, WritingCommandError> {
    let path = history::db_path(&app_handle)?;
    let limit = limit.unwrap_or(10).clamp(1, 50) as i64;
    run_blocking(move || -> Result<Vec<WritingTaskSummary>, WritingCommandError> {
        let conn = history::open_connection(&path)?;
        Ok(history::recent_writing_tasks(&conn, limit)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_evaluation() -> StructuredWritingEvaluation {
        StructuredWritingEvaluation {
            overall_level: CefrLevel::B2,
            dimensions: StructuredDimensions {
                task_achievement: StructuredDimensionResult {
                    level: CefrLevel::B2,
                    evidence: "Clearly states the purpose in the first line.".to_string(),
                },
                coherence_cohesion: StructuredDimensionResult {
                    level: CefrLevel::B1,
                    evidence: "Uses basic linking words only.".to_string(),
                },
                lexical_resource: StructuredDimensionResult {
                    level: CefrLevel::B1,
                    evidence: "Relies on simple vocabulary.".to_string(),
                },
                grammar: StructuredDimensionResult {
                    level: CefrLevel::B2,
                    evidence: "Uses a mix of simple and complex sentences accurately.".to_string(),
                },
                register_tone: StructuredDimensionResult {
                    level: CefrLevel::B2,
                    evidence: "Maintains a professional tone throughout.".to_string(),
                },
            },
            priority_issues: vec![StructuredPriorityIssue {
                category: WritingDimension::LexicalResource,
                original: "I have much experience".to_string(),
                suggested: "I have extensive experience".to_string(),
                explanation: "\"Extensive experience\" is the natural professional collocation.".to_string(),
            }],
            useful_chunks: vec![StructuredUsefulChunk {
                chunk: "I have extensive experience with...".to_string(),
                register: "professional".to_string(),
                example: "I have extensive experience with React and TypeScript.".to_string(),
            }],
            rewrite_instruction: "Focus on replacing informal collocations with professional ones.".to_string(),
        }
    }

    #[test]
    fn validated_accepts_a_well_formed_payload() {
        assert!(valid_evaluation().validated().is_ok());
    }

    #[test]
    fn validated_rejects_zero_priority_issues() {
        let mut evaluation = valid_evaluation();
        evaluation.priority_issues.clear();
        let error = evaluation.validated().expect_err("must reject empty priority issues");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_more_than_three_priority_issues() {
        let mut evaluation = valid_evaluation();
        let issue = evaluation.priority_issues[0].clone();
        evaluation.priority_issues = vec![issue.clone(), issue.clone(), issue.clone(), issue];
        let error = evaluation.validated().expect_err("must reject more than 3 priority issues");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_blank_fields_after_trim() {
        let mut evaluation = valid_evaluation();
        evaluation.priority_issues[0].suggested = "   ".to_string();
        let error = evaluation.validated().expect_err("must reject blank suggested field");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn validated_rejects_empty_useful_chunks() {
        let mut evaluation = valid_evaluation();
        evaluation.useful_chunks.clear();
        let error = evaluation.validated().expect_err("must reject empty useful chunks");
        assert_eq!(error.code, "invalid-response");
    }

    #[test]
    fn task_blueprints_cover_all_six_task_types_with_no_empty_fields() {
        let blueprints = task_blueprints();
        assert_eq!(blueprints.len(), 6);
        for blueprint in &blueprints {
            assert!(!blueprint.label.trim().is_empty());
            assert!(!blueprint.communicative_goal.trim().is_empty());
            assert!(!blueprint.rubric.trim().is_empty());
            assert!(!blueprint.success_criteria.is_empty());
            assert!(!blueprint.recommended_chunks.is_empty());
            assert!(blueprint.suggested_word_min < blueprint.suggested_word_max);
        }

        let task_types = [
            WritingTaskType::ProfessionalEmail,
            WritingTaskType::OpinionParagraph,
            WritingTaskType::TechnicalExplanation,
            WritingTaskType::Summary,
            WritingTaskType::Recommendation,
            WritingTaskType::ShortArgument,
        ];
        for task_type in task_types {
            // find_blueprint panics if a type is missing an entry.
            let _ = find_blueprint(task_type);
        }
    }

    #[test]
    fn review_type_from_writing_dimension_maps_as_expected() {
        assert_eq!(
            review_type_from_writing_dimension(WritingDimension::LexicalResource),
            ReviewItemType::Vocabulary
        );
        assert_eq!(
            review_type_from_writing_dimension(WritingDimension::Grammar),
            ReviewItemType::GrammarPattern
        );
        assert_eq!(
            review_type_from_writing_dimension(WritingDimension::RegisterTone),
            ReviewItemType::Phrase
        );
        assert_eq!(
            review_type_from_writing_dimension(WritingDimension::TaskAchievement),
            ReviewItemType::ConversationStrategy
        );
        assert_eq!(
            review_type_from_writing_dimension(WritingDimension::CoherenceCohesion),
            ReviewItemType::ConversationStrategy
        );
    }

    #[test]
    fn review_drafts_from_evaluation_includes_issues_and_chunks() {
        let record: WritingEvaluationRecord = valid_evaluation().validated().unwrap().into();
        let drafts = review_drafts_from_evaluation(&record);
        assert_eq!(drafts.len(), 2);
        assert!(drafts[0].1.contains("extensive experience"));
        assert!(drafts[1].1.contains("I have extensive experience with..."));
    }
}
