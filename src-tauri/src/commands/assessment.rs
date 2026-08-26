use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::history;
use super::tutor::{self, OllamaRequestMessage, TutorCommandError, TutorPerformance};

const FOLLOW_UP_SYSTEM_INSTRUCTION: &str = r#"You are the question-wording component of an English speaking assessment. You do not decide what is being measured — that has already been decided by a separate component. Your only job is to produce one natural, conversational follow-up question in English that pursues a specific communicative-function target, grounded in what the learner just said.

You will be given: the target CEFR difficulty band, a required follow-up intent (the language function the question must elicit, for example counterArgument or hypothesize), the previous question, the learner's answer, and constraints.

Rules:
- The question must clearly invite the learner to perform the required intent (for example, if the intent is counterArgument, ask them to respond to an opposing view; if hypothesize, ask what they would do differently in a hypothetical version of their own situation).
- Ground the question in specific content from the learner's own answer. Do not ask a generic or templated question.
- Never require obscure cultural knowledge, specialized academic facts, specific technical expertise, or specific political or historical knowledge the learner has not already demonstrated. If the learner described a professional or technical situation, you may reference it, but do not require them to know more about that domain than they already showed.
- Respect maxQuestions in the constraints: ask exactly one question, phrased naturally, short enough to be spoken aloud (one or two sentences).
- Do not evaluate, grade, or comment on the learner's English in any way. Do not praise, correct, or mention proficiency level. Your only output is the next question.
- Do not reveal or refer to CEFR levels, competencies, scoring, or the assessment process itself.

Always return exactly this JSON object shape, using this exact field name:
{
  "question": "the single follow-up question, ready to be spoken"
}"#;

const EVALUATOR_SYSTEM_INSTRUCTION: &str = r#"You are an independent English speaking assessment evaluator. You never ask questions or converse with the learner — a separate component already did that. Your only job is to judge the linguistic evidence in one learner answer against a fixed rubric, for a fixed set of competencies, and return evidence-grounded scores.

You will be given the task's target CEFR range, the competencies to evaluate, the language functions the task required, the question that was asked, and the learner's transcribed answer.

For each requested competency, decide:
- levelEvidence: your best-supported single CEFR level (A1, A2, B1, B2, C1, or C2) for what this answer demonstrates for that competency. Omit this field entirely when the answer does not contain enough signal to judge it.
- confidence: a number from 0.0 to 1.0, how strongly the answer supports that level. Use 0.0 when insufficientEvidence is true.
- evidence: one to three short, specific observations from the actual answer that justify the score, for example "Used a subordinate clause to compare two options accurately." Never leave this empty when insufficientEvidence is false.
- insufficientEvidence: true only when the answer is too short, off-topic, or otherwise does not let you judge this competency; in that case omit levelEvidence, set confidence to 0.0, and leave evidence empty.

Rules:
- You are given a transcript only, not audio. Never claim to hear pronunciation, intonation, stress, rhythm, or any other audio quality. For the pronunciation competency, you may only comment on intelligibility signal available from the transcript itself, such as whether the text suggests the transcription broke down or was incoherent. If there is no such signal, mark pronunciation as insufficientEvidence. Do not infer pronunciation from spelling, word choice, or grammar.
- For the listening competency, mark insufficientEvidence unless the task itself required demonstrating listening comprehension (this assessment currently has no listening tasks, so listening should always be insufficientEvidence).
- Judge only the English demonstrated. If the answer describes a professional or technical topic, do not judge whether the technical content is correct — judge only how it was expressed in English.
- Do not be swayed by how interesting, correct, or agreeable the learner's opinion is. Judge language only.
- Never invent a confident score without evidence. When in doubt, prefer insufficientEvidence over guessing.
- Do not include a global or overall level anywhere in your response. You only ever return per-competency evidence for the competencies you were asked to evaluate.

Always return exactly this JSON object shape, with exactly one entry per requested competency:
{
  "competencyEvidence": [
    {
      "competency": "fluency",
      "levelEvidence": "B2",
      "confidence": 0.84,
      "evidence": ["Maintained an extended response with limited language-search hesitation."],
      "insufficientEvidence": false
    }
  ]
}"#;

const SUMMARY_SYSTEM_INSTRUCTION: &str = r#"You are the recommendation-writing component of an English speaking assessment. Levels have already been determined by a separate, deterministic component and are given to you below as fixed facts. You are not scoring or leveling the learner, and you cannot change any level — your response has no field for one. Do not question, revise, restate as uncertain, or contradict the levels you are given.

You will be given the learner's overall estimated level and a per-competency profile, each with a level (or "insufficient evidence"), a confidence value, and short evidence quotes from their answers.

Your only job is to write:
- priorities: concrete, specific gaps to work on next, grounded in the evidence given (for example "past tense accuracy in narrated stories", "linking ideas across multi-sentence answers"). Never vague statements like "keep practicing" or "improve English."
- recommendedSessions: concrete next session types or topics grounded in the priorities you identified (for example "daily routine narration", "job interview roleplay", "storytelling with past tense").
- notesForTutor: a short internal note for a future tutoring session, not shown to celebrate or shame the learner. State any confidence caveats plainly if coverage was thin, name the single biggest bottleneck, and suggest what listening/input level would suit this learner next.

Never write empty motivational praise. Ground every sentence in the evidence you were given, not in a generic template.

Always return exactly this JSON object shape, using these exact field names:
{
  "priorities": ["..."],
  "recommendedSessions": ["..."],
  "notesForTutor": "..."
}"#;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentCommandError {
    code: &'static str,
    message: String,
    technical_message: String,
}

impl AssessmentCommandError {
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

impl From<TutorCommandError> for AssessmentCommandError {
    fn from(error: TutorCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

impl From<history::HistoryCommandError> for AssessmentCommandError {
    fn from(error: history::HistoryCommandError) -> Self {
        let (code, message, technical_message) = error.into_parts();
        Self {
            code,
            message,
            technical_message,
        }
    }
}

fn required_text(value: String, field: &str) -> Result<String, AssessmentCommandError> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(AssessmentCommandError::new(
            "invalid-response",
            "The assessment model returned an invalid structured response.",
            format!("The {field} field was empty."),
        ));
    }

    Ok(normalized)
}

/// Which assessment component is requesting Ollama settings. Every role
/// currently resolves to the same tutor.json configuration; this is the
/// seam that lets a future distinct evaluator model be introduced later
/// (e.g. a slower, higher-quality model for evidence evaluation) without
/// touching any call site in generate_follow_up / evaluate_response /
/// synthesize_assessment_summary.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AssessmentModelRole {
    FollowUpGeneration,
    EvidenceEvaluation,
    SummarySynthesis,
}

async fn resolve_assessment_settings(
    app_handle: &AppHandle,
    _role: AssessmentModelRole,
) -> Result<tutor::TutorSettings, AssessmentCommandError> {
    let path = tutor::config_path(app_handle)?;
    let settings = tutor::load_settings(path).await?;
    Ok(settings)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "UPPERCASE")]
pub enum CefrLevel {
    A1,
    A2,
    B1,
    B2,
    C1,
    C2,
}

pub(crate) fn cefr_level_str(level: CefrLevel) -> &'static str {
    match level {
        CefrLevel::A1 => "A1",
        CefrLevel::A2 => "A2",
        CefrLevel::B1 => "B1",
        CefrLevel::B2 => "B2",
        CefrLevel::C1 => "C1",
        CefrLevel::C2 => "C2",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AssessmentCompetency {
    Fluency,
    GrammaticalRange,
    GrammaticalAccuracy,
    LexicalResource,
    DiscourseManagement,
    InteractiveCommunication,
    Pronunciation,
    Listening,
}

pub(crate) fn competency_label(competency: AssessmentCompetency) -> &'static str {
    match competency {
        AssessmentCompetency::Fluency => "fluency",
        AssessmentCompetency::GrammaticalRange => "grammaticalRange",
        AssessmentCompetency::GrammaticalAccuracy => "grammaticalAccuracy",
        AssessmentCompetency::LexicalResource => "lexicalResource",
        AssessmentCompetency::DiscourseManagement => "discourseManagement",
        AssessmentCompetency::InteractiveCommunication => "interactiveCommunication",
        AssessmentCompetency::Pronunciation => "pronunciation",
        AssessmentCompetency::Listening => "listening",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LanguageFunction {
    Describe,
    Narrate,
    Explain,
    Clarify,
    Compare,
    Justify,
    Hypothesize,
    CounterArgument,
    Reformulate,
    Negotiate,
    ExpressOpinion,
    QualifyStatement,
}

fn language_function_label(function: LanguageFunction) -> &'static str {
    match function {
        LanguageFunction::Describe => "describe",
        LanguageFunction::Narrate => "narrate",
        LanguageFunction::Explain => "explain",
        LanguageFunction::Clarify => "clarify / ask for clarification",
        LanguageFunction::Compare => "compare",
        LanguageFunction::Justify => "justify a choice or opinion",
        LanguageFunction::Hypothesize => "reason about a hypothetical",
        LanguageFunction::CounterArgument => "respond to a counter-argument",
        LanguageFunction::Reformulate => "reformulate or restate an idea",
        LanguageFunction::Negotiate => "negotiate or resolve a disagreement",
        LanguageFunction::ExpressOpinion => "express an opinion",
        LanguageFunction::QualifyStatement => "qualify or nuance a statement",
    }
}

// ---------------------------------------------------------------------
// FollowUpGenerator
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FollowUpConstraints {
    requires_specialist_knowledge: bool,
    max_questions: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FollowUpRequest {
    target_cefr: String,
    follow_up_intent: LanguageFunction,
    previous_question: String,
    learner_answer: String,
    constraints: FollowUpConstraints,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredFollowUp {
    question: String,
}

impl StructuredFollowUp {
    fn validated(self) -> Result<Self, AssessmentCommandError> {
        Ok(Self {
            question: required_text(self.question, "question")?,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpTurn {
    question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn follow_up_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "question": { "type": "string", "minLength": 1 }
        },
        "required": ["question"]
    })
}

fn follow_up_messages(request: &FollowUpRequest) -> Vec<OllamaRequestMessage> {
    let user_content = format!(
        "Target CEFR band: {}\nRequired follow-up intent: {}\nPrevious question: {}\nLearner answer: {}\nConstraints: requires specialist knowledge = {}, max questions = {}",
        request.target_cefr,
        language_function_label(request.follow_up_intent),
        request.previous_question,
        request.learner_answer,
        request.constraints.requires_specialist_knowledge,
        request.constraints.max_questions,
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: FOLLOW_UP_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

async fn generate_follow_up_turn(
    settings: &tutor::TutorSettings,
    request: FollowUpRequest,
) -> Result<FollowUpTurn, AssessmentCommandError> {
    let messages = follow_up_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        settings,
        tutor::StructuredChatRequest {
            messages,
            schema: follow_up_response_schema(),
            temperature: 0.4,
            think: false,
            request_failed_code: "assessment-request-failed",
            timeout_message: "The assessment model took too long to respond.",
            failure_message: "The assessment request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredFollowUp>(&content)
        .map_err(|error| {
            AssessmentCommandError::new(
                "invalid-response",
                "The assessment model returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    Ok(FollowUpTurn {
        question: parsed.question,
        performance,
    })
}

#[tauri::command]
pub async fn generate_follow_up(
    app_handle: AppHandle,
    request: FollowUpRequest,
) -> Result<FollowUpTurn, AssessmentCommandError> {
    let settings =
        resolve_assessment_settings(&app_handle, AssessmentModelRole::FollowUpGeneration).await?;
    generate_follow_up_turn(&settings, request).await
}

// ---------------------------------------------------------------------
// EvidenceEvaluator
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CefrRangeWire {
    min: CefrLevel,
    max: CefrLevel,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluateResponseRequest {
    task_id: String,
    target_cefr_range: CefrRangeWire,
    competencies: Vec<AssessmentCompetency>,
    required_functions: Vec<LanguageFunction>,
    question: String,
    learner_answer: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredCompetencyEvidence {
    competency: AssessmentCompetency,
    #[serde(default)]
    level_evidence: Option<CefrLevel>,
    confidence: f64,
    #[serde(default)]
    evidence: Vec<String>,
    insufficient_evidence: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredEvaluation {
    competency_evidence: Vec<StructuredCompetencyEvidence>,
}

impl StructuredEvaluation {
    fn validated(
        mut self,
        requested: &[AssessmentCompetency],
    ) -> Result<Self, AssessmentCommandError> {
        if self.competency_evidence.len() != requested.len() {
            return Err(AssessmentCommandError::new(
                "invalid-response",
                "The evaluator did not score every requested competency.",
                format!(
                    "expected {} competencies, got {}",
                    requested.len(),
                    self.competency_evidence.len()
                ),
            ));
        }

        let mut seen = std::collections::HashSet::new();
        for entry in &mut self.competency_evidence {
            if !seen.insert(entry.competency) {
                return Err(AssessmentCommandError::new(
                    "invalid-response",
                    "The evaluator returned a duplicate competency.",
                    format!("duplicate competency: {:?}", entry.competency),
                ));
            }
            if !requested.contains(&entry.competency) {
                return Err(AssessmentCommandError::new(
                    "invalid-response",
                    "The evaluator scored a competency that was not requested.",
                    format!("unexpected competency: {:?}", entry.competency),
                ));
            }
            if !entry.confidence.is_finite() || !(0.0..=1.0).contains(&entry.confidence) {
                return Err(AssessmentCommandError::new(
                    "invalid-response",
                    "The evaluator returned an invalid confidence score.",
                    format!("confidence out of range: {}", entry.confidence),
                ));
            }

            if entry.insufficient_evidence {
                if entry.level_evidence.is_some()
                    || entry.confidence != 0.0
                    || !entry.evidence.is_empty()
                {
                    return Err(AssessmentCommandError::new(
                        "invalid-response",
                        "The evaluator returned inconsistent insufficient-evidence data.",
                        "insufficientEvidence was true but levelEvidence, confidence, or evidence were not empty",
                    ));
                }
            } else {
                if entry.level_evidence.is_none() {
                    return Err(AssessmentCommandError::new(
                        "invalid-response",
                        "The evaluator did not provide a level for a scored competency.",
                        "levelEvidence was missing while insufficientEvidence was false",
                    ));
                }
                if entry.evidence.is_empty() {
                    return Err(AssessmentCommandError::new(
                        "invalid-response",
                        "The evaluator did not provide supporting evidence.",
                        "evidence was empty while insufficientEvidence was false",
                    ));
                }
                for (index, item) in entry.evidence.iter_mut().enumerate() {
                    *item = required_text(std::mem::take(item), &format!("evidence[{index}]"))?;
                }
            }
        }

        Ok(self)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompetencyEvidenceResult {
    competency: AssessmentCompetency,
    #[serde(skip_serializing_if = "Option::is_none")]
    level_evidence: Option<CefrLevel>,
    confidence: f64,
    evidence: Vec<String>,
    insufficient_evidence: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationResult {
    competency_evidence: Vec<CompetencyEvidenceResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn evaluation_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "competencyEvidence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "competency": {
                            "type": "string",
                            "enum": [
                                "fluency", "grammaticalRange", "grammaticalAccuracy", "lexicalResource",
                                "discourseManagement", "interactiveCommunication", "pronunciation", "listening"
                            ]
                        },
                        "levelEvidence": {
                            "type": "string",
                            "enum": ["A1", "A2", "B1", "B2", "C1", "C2"]
                        },
                        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                        "evidence": { "type": "array", "items": { "type": "string", "minLength": 1 } },
                        "insufficientEvidence": { "type": "boolean" }
                    },
                    "required": ["competency", "confidence", "evidence", "insufficientEvidence"]
                }
            }
        },
        "required": ["competencyEvidence"]
    })
}

fn evaluate_messages(request: &EvaluateResponseRequest) -> Vec<OllamaRequestMessage> {
    let competencies_label = request
        .competencies
        .iter()
        .map(|competency| competency_label(*competency))
        .collect::<Vec<_>>()
        .join(", ");
    let functions_label = request
        .required_functions
        .iter()
        .map(|function| language_function_label(*function))
        .collect::<Vec<_>>()
        .join(", ");
    let user_content = format!(
        "Task: {}\nTarget CEFR range: {}-{}\nCompetencies to evaluate: {}\nLanguage functions this task required: {}\nQuestion asked: {}\nLearner answer: {}",
        request.task_id,
        cefr_level_str(request.target_cefr_range.min),
        cefr_level_str(request.target_cefr_range.max),
        competencies_label,
        functions_label,
        request.question,
        request.learner_answer,
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: EVALUATOR_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

async fn evaluate_response_evidence(
    settings: &tutor::TutorSettings,
    request: EvaluateResponseRequest,
) -> Result<EvaluationResult, AssessmentCommandError> {
    let requested = request.competencies.clone();
    let messages = evaluate_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        settings,
        tutor::StructuredChatRequest {
            messages,
            schema: evaluation_response_schema(),
            temperature: 0.15,
            think: false,
            request_failed_code: "assessment-request-failed",
            timeout_message: "The assessment model took too long to respond.",
            failure_message: "The assessment request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredEvaluation>(&content)
        .map_err(|error| {
            AssessmentCommandError::new(
                "invalid-response",
                "The assessment model returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated(&requested)?;

    Ok(EvaluationResult {
        competency_evidence: parsed
            .competency_evidence
            .into_iter()
            .map(|entry| CompetencyEvidenceResult {
                competency: entry.competency,
                level_evidence: entry.level_evidence,
                confidence: entry.confidence,
                evidence: entry.evidence,
                insufficient_evidence: entry.insufficient_evidence,
            })
            .collect(),
        performance,
    })
}

#[tauri::command]
pub async fn evaluate_response(
    app_handle: AppHandle,
    request: EvaluateResponseRequest,
) -> Result<EvaluationResult, AssessmentCommandError> {
    if request.competencies.is_empty() {
        return Err(AssessmentCommandError::new(
            "no-competencies",
            "At least one competency must be requested for evaluation.",
            "competencies was empty",
        ));
    }
    let settings =
        resolve_assessment_settings(&app_handle, AssessmentModelRole::EvidenceEvaluation).await?;
    evaluate_response_evidence(&settings, request).await
}

// ---------------------------------------------------------------------
// SummarySynthesizer
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompetencyProfileWire {
    competency: AssessmentCompetency,
    #[serde(default)]
    level: Option<CefrLevel>,
    confidence: f64,
    #[serde(default)]
    evidence: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynthesizeSummaryRequest {
    #[serde(default)]
    overall_level: Option<CefrLevel>,
    overall_confidence: f64,
    competency_profiles: Vec<CompetencyProfileWire>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredSummary {
    priorities: Vec<String>,
    recommended_sessions: Vec<String>,
    notes_for_tutor: String,
}

impl StructuredSummary {
    fn validated(mut self) -> Result<Self, AssessmentCommandError> {
        for (index, priority) in self.priorities.iter_mut().enumerate() {
            *priority = required_text(std::mem::take(priority), &format!("priorities[{index}]"))?;
        }
        for (index, session) in self.recommended_sessions.iter_mut().enumerate() {
            *session = required_text(
                std::mem::take(session),
                &format!("recommendedSessions[{index}]"),
            )?;
        }
        self.notes_for_tutor = required_text(self.notes_for_tutor, "notesForTutor")?;
        Ok(self)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentSummaryText {
    priorities: Vec<String>,
    recommended_sessions: Vec<String>,
    notes_for_tutor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    performance: Option<TutorPerformance>,
}

fn summary_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "priorities": { "type": "array", "items": { "type": "string", "minLength": 1 } },
            "recommendedSessions": { "type": "array", "items": { "type": "string", "minLength": 1 } },
            "notesForTutor": { "type": "string", "minLength": 1 }
        },
        "required": ["priorities", "recommendedSessions", "notesForTutor"]
    })
}

fn summary_messages(request: &SynthesizeSummaryRequest) -> Vec<OllamaRequestMessage> {
    let overall = request
        .overall_level
        .map(cefr_level_str)
        .unwrap_or("insufficient evidence");
    let mut profile_lines = Vec::new();
    for profile in &request.competency_profiles {
        let level = profile
            .level
            .map(cefr_level_str)
            .unwrap_or("insufficient evidence");
        let evidence = if profile.evidence.is_empty() {
            "(no evidence)".to_string()
        } else {
            profile.evidence.join("; ")
        };
        profile_lines.push(format!(
            "- {}: {} (confidence {:.2}) — evidence: {}",
            competency_label(profile.competency),
            level,
            profile.confidence,
            evidence
        ));
    }
    let user_content = format!(
        "Overall estimated level: {} (confidence {:.2})\nCompetency profile:\n{}",
        overall,
        request.overall_confidence,
        profile_lines.join("\n")
    );
    vec![
        OllamaRequestMessage {
            role: "system",
            content: SUMMARY_SYSTEM_INSTRUCTION.to_string(),
        },
        OllamaRequestMessage {
            role: "user",
            content: user_content,
        },
    ]
}

async fn synthesize_summary_text(
    settings: &tutor::TutorSettings,
    request: SynthesizeSummaryRequest,
) -> Result<AssessmentSummaryText, AssessmentCommandError> {
    let messages = summary_messages(&request);
    let (content, performance) = tutor::perform_structured_chat(
        settings,
        tutor::StructuredChatRequest {
            messages,
            schema: summary_response_schema(),
            temperature: 0.4,
            think: false,
            request_failed_code: "assessment-request-failed",
            timeout_message: "The assessment model took too long to respond.",
            failure_message: "The assessment request could not complete.",
        },
    )
    .await?;
    let parsed = serde_json::from_str::<StructuredSummary>(&content)
        .map_err(|error| {
            AssessmentCommandError::new(
                "invalid-response",
                "The assessment model returned invalid structured output.",
                error.to_string(),
            )
        })?
        .validated()?;

    Ok(AssessmentSummaryText {
        priorities: parsed.priorities,
        recommended_sessions: parsed.recommended_sessions,
        notes_for_tutor: parsed.notes_for_tutor,
        performance,
    })
}

#[tauri::command]
pub async fn synthesize_assessment_summary(
    app_handle: AppHandle,
    request: SynthesizeSummaryRequest,
) -> Result<AssessmentSummaryText, AssessmentCommandError> {
    let settings =
        resolve_assessment_settings(&app_handle, AssessmentModelRole::SummarySynthesis).await?;
    synthesize_summary_text(&settings, request).await
}

// ---------------------------------------------------------------------
// Persistence bridge — thin tauri commands over history.rs's assessment
// tables. The frontend Controller decides task/turn boundaries; each of
// these commands persists one step of that decision so re-running an
// assessment only ever inserts new rows (see history.rs for the schema
// and the "retake does not delete prior history" test).
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartAssessmentRequest {
    blueprint_version: String,
    rubric_version: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentStart {
    assessment_id: i64,
}

#[tauri::command]
pub async fn start_assessment(
    app_handle: AppHandle,
    request: StartAssessmentRequest,
) -> Result<AssessmentStart, AssessmentCommandError> {
    let assessment_id = history::start_assessment(
        &app_handle,
        request.blueprint_version,
        request.rubric_version,
    )
    .await?;
    Ok(AssessmentStart { assessment_id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartAssessmentTaskRunRequest {
    assessment_id: i64,
    task_id: String,
    target_cefr_min: CefrLevel,
    target_cefr_max: CefrLevel,
    difficulty: CefrLevel,
    anchor_used: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTaskRunStart {
    task_run_id: i64,
}

#[tauri::command]
pub async fn start_assessment_task_run(
    app_handle: AppHandle,
    request: StartAssessmentTaskRunRequest,
) -> Result<AssessmentTaskRunStart, AssessmentCommandError> {
    let task_run_id = history::start_assessment_task_run(
        &app_handle,
        request.assessment_id,
        request.task_id,
        request.target_cefr_min,
        request.target_cefr_max,
        request.difficulty,
        request.anchor_used,
    )
    .await?;
    Ok(AssessmentTaskRunStart { task_run_id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompetencyEvidenceWrite {
    competency: AssessmentCompetency,
    #[serde(default)]
    level_evidence: Option<CefrLevel>,
    confidence: f64,
    #[serde(default)]
    evidence: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordAssessmentTurnCycleRequest {
    task_run_id: i64,
    prompt_text: String,
    answer_text: String,
    #[serde(default)]
    follow_up_intent: Option<String>,
    #[serde(default)]
    evidence: Vec<CompetencyEvidenceWrite>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTurnCycleResult {
    answer_turn_id: i64,
}

#[tauri::command]
pub async fn record_assessment_turn_cycle(
    app_handle: AppHandle,
    request: RecordAssessmentTurnCycleRequest,
) -> Result<AssessmentTurnCycleResult, AssessmentCommandError> {
    let evidence = request
        .evidence
        .into_iter()
        .map(|item| {
            (
                item.competency,
                item.level_evidence,
                item.confidence,
                item.evidence,
            )
        })
        .collect();
    let answer_turn_id = history::persist_assessment_turn_cycle(
        &app_handle,
        request.task_run_id,
        request.prompt_text,
        request.answer_text,
        request.follow_up_intent,
        evidence,
    )
    .await?;
    Ok(AssessmentTurnCycleResult { answer_turn_id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteAssessmentTaskRunRequest {
    task_run_id: i64,
    follow_ups_used: i64,
}

#[tauri::command]
pub async fn complete_assessment_task_run(
    app_handle: AppHandle,
    request: CompleteAssessmentTaskRunRequest,
) -> Result<(), AssessmentCommandError> {
    history::complete_assessment_task_run(
        &app_handle,
        request.task_run_id,
        request.follow_ups_used,
    )
    .await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteAssessmentRequest {
    assessment_id: i64,
    #[serde(default)]
    estimated_level: Option<CefrLevel>,
    #[serde(default)]
    confidence: Option<f64>,
}

#[tauri::command]
pub async fn complete_assessment(
    app_handle: AppHandle,
    request: CompleteAssessmentRequest,
) -> Result<(), AssessmentCommandError> {
    history::complete_assessment(
        &app_handle,
        request.assessment_id,
        request.estimated_level,
        request.confidence,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_latest_assessment(
    app_handle: AppHandle,
) -> Result<Option<history::AssessmentSummary>, AssessmentCommandError> {
    Ok(history::latest_assessment_result(&app_handle).await?)
}

#[tauri::command]
pub async fn list_assessments(
    app_handle: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<history::AssessmentSummary>, AssessmentCommandError> {
    Ok(history::list_assessment_results(&app_handle, limit).await?)
}

#[tauri::command]
pub async fn get_assessment_detail(
    app_handle: AppHandle,
    assessment_id: i64,
) -> Result<Option<history::AssessmentDetail>, AssessmentCommandError> {
    Ok(history::assessment_detail_by_id(&app_handle, assessment_id).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::mpsc::{self, Receiver},
        thread::{self, JoinHandle},
        time::Duration,
    };

    struct ResponseFixture {
        path: &'static str,
        status: u16,
        body: String,
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("read timeout must set");
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2_048];
        let mut expected_length = None;

        loop {
            let count = stream.read(&mut buffer).expect("request must read");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);

            if expected_length.is_none() {
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    expected_length = Some(header_end + 4 + content_length);
                }
            }

            if expected_length.is_some_and(|length| bytes.len() >= length) {
                break;
            }
        }

        String::from_utf8(bytes).expect("request must be utf8")
    }

    fn mock_ollama(fixtures: Vec<ResponseFixture>) -> (String, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener must bind");
        let address = listener
            .local_addr()
            .expect("listener address must resolve");
        let (sender, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            for fixture in fixtures {
                let (mut stream, _) = listener.accept().expect("request must connect");
                let request = read_request(&mut stream);
                assert!(
                    request.starts_with(&format!("GET {} ", fixture.path))
                        || request.starts_with(&format!("POST {} ", fixture.path)),
                    "unexpected request: {request}"
                );
                let _ = sender.send(request);
                let reason = if fixture.status == 200 {
                    "OK"
                } else {
                    "Internal Server Error"
                };
                write!(
                    stream,
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    fixture.status,
                    reason,
                    fixture.body.len(),
                    fixture.body
                )
                .expect("response must write");
            }
        });

        (format!("http://{address}"), receiver, handle)
    }

    fn version_fixture() -> ResponseFixture {
        ResponseFixture {
            path: "/api/version",
            status: 200,
            body: json!({ "version": "0.20.4" }).to_string(),
        }
    }

    fn tags_fixture() -> ResponseFixture {
        ResponseFixture {
            path: "/api/tags",
            status: 200,
            body: json!({
                "models": [
                    { "name": "qwen3.5:9b", "model": "qwen3.5:9b", "details": { "parameter_size": "9B" } }
                ]
            })
            .to_string(),
        }
    }

    fn chat_fixture(status: u16, content: &str) -> ResponseFixture {
        ResponseFixture {
            path: "/api/chat",
            status,
            body: json!({
                "message": { "content": content },
                "eval_count": 42,
                "eval_duration": 1_000_000_000_u64
            })
            .to_string(),
        }
    }

    fn settings(base_url: String) -> tutor::TutorSettings {
        tutor::test_settings(base_url, "qwen3.5:9b")
    }

    fn follow_up_request() -> FollowUpRequest {
        FollowUpRequest {
            target_cefr: "B2-C1".into(),
            follow_up_intent: LanguageFunction::CounterArgument,
            previous_question: "Tell me about a technical decision you made recently.".into(),
            learner_answer: "We migrated the application because maintaining the old stack was becoming difficult.".into(),
            constraints: FollowUpConstraints {
                requires_specialist_knowledge: false,
                max_questions: 1,
            },
        }
    }

    #[test]
    fn follow_up_happy_path_returns_question() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({ "question": "What would you say to someone who thinks the old approach would have been safer?" })
                        .to_string(),
                ),
            ]);

            let result = generate_follow_up_turn(&settings(base_url), follow_up_request())
                .await
                .expect("follow-up must succeed");
            server.join().expect("server must finish");

            assert!(result.question.contains("safer"));
        });
    }

    #[test]
    fn follow_up_rejects_malformed_json_recoverably() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(200, "not valid json"),
            ]);

            let error = generate_follow_up_turn(&settings(base_url), follow_up_request())
                .await
                .expect_err("malformed JSON must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn follow_up_rejects_wrong_field_name() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(200, &json!({ "reply": "wrong field" }).to_string()),
            ]);

            let error = generate_follow_up_turn(&settings(base_url), follow_up_request())
                .await
                .expect_err("wrong field name must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn follow_up_rejects_empty_question() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(200, &json!({ "question": "   " }).to_string()),
            ]);

            let error = generate_follow_up_turn(&settings(base_url), follow_up_request())
                .await
                .expect_err("empty question must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    fn evaluate_request() -> EvaluateResponseRequest {
        EvaluateResponseRequest {
            task_id: "extended_production.technical_decision.v1".into(),
            target_cefr_range: CefrRangeWire {
                min: CefrLevel::B2,
                max: CefrLevel::C1,
            },
            competencies: vec![
                AssessmentCompetency::Fluency,
                AssessmentCompetency::LexicalResource,
            ],
            required_functions: vec![LanguageFunction::Explain, LanguageFunction::Justify],
            question: "Tell me about a technical decision you made recently.".into(),
            learner_answer: "We migrated the application because maintaining the old stack was becoming difficult.".into(),
        }
    }

    #[test]
    fn evaluate_happy_path_returns_evidence_per_competency() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "competencyEvidence": [
                            {
                                "competency": "fluency",
                                "levelEvidence": "B2",
                                "confidence": 0.84,
                                "evidence": ["Maintained an extended response with limited hesitation."],
                                "insufficientEvidence": false
                            },
                            {
                                "competency": "lexicalResource",
                                "levelEvidence": "C1",
                                "confidence": 0.68,
                                "evidence": ["Used precise vocabulary to discuss trade-offs."],
                                "insufficientEvidence": false
                            }
                        ]
                    })
                    .to_string(),
                ),
            ]);

            let result = evaluate_response_evidence(&settings(base_url), evaluate_request())
                .await
                .expect("evaluation must succeed");
            server.join().expect("server must finish");

            assert_eq!(result.competency_evidence.len(), 2);
            assert_eq!(
                result.competency_evidence[0].level_evidence,
                Some(CefrLevel::B2)
            );
        });
    }

    #[test]
    fn evaluate_rejects_missing_requested_competency() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "competencyEvidence": [
                            {
                                "competency": "fluency",
                                "levelEvidence": "B2",
                                "confidence": 0.84,
                                "evidence": ["ok"],
                                "insufficientEvidence": false
                            }
                        ]
                    })
                    .to_string(),
                ),
            ]);

            let error = evaluate_response_evidence(&settings(base_url), evaluate_request())
                .await
                .expect_err("missing competency must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn evaluate_rejects_insufficient_evidence_contradiction() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "competencyEvidence": [
                            {
                                "competency": "fluency",
                                "levelEvidence": "B2",
                                "confidence": 0.5,
                                "evidence": [],
                                "insufficientEvidence": true
                            },
                            {
                                "competency": "lexicalResource",
                                "confidence": 0.0,
                                "evidence": [],
                                "insufficientEvidence": true
                            }
                        ]
                    })
                    .to_string(),
                ),
            ]);

            let error = evaluate_response_evidence(&settings(base_url), evaluate_request())
                .await
                .expect_err("contradiction must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn evaluate_rejects_confidence_out_of_range_even_if_schema_missed_it() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "competencyEvidence": [
                            {
                                "competency": "fluency",
                                "levelEvidence": "B2",
                                "confidence": 1.5,
                                "evidence": ["ok"],
                                "insufficientEvidence": false
                            },
                            {
                                "competency": "lexicalResource",
                                "levelEvidence": "B2",
                                "confidence": 0.5,
                                "evidence": ["ok"],
                                "insufficientEvidence": false
                            }
                        ]
                    })
                    .to_string(),
                ),
            ]);

            let error = evaluate_response_evidence(&settings(base_url), evaluate_request())
                .await
                .expect_err("out of range confidence must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn evaluate_rejects_evidence_without_level_when_not_insufficient() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "competencyEvidence": [
                            {
                                "competency": "fluency",
                                "confidence": 0.5,
                                "evidence": ["ok"],
                                "insufficientEvidence": false
                            },
                            {
                                "competency": "lexicalResource",
                                "levelEvidence": "B2",
                                "confidence": 0.5,
                                "evidence": ["ok"],
                                "insufficientEvidence": false
                            }
                        ]
                    })
                    .to_string(),
                ),
            ]);

            let error = evaluate_response_evidence(&settings(base_url), evaluate_request())
                .await
                .expect_err("missing level without insufficientEvidence must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    fn summary_request() -> SynthesizeSummaryRequest {
        SynthesizeSummaryRequest {
            overall_level: Some(CefrLevel::B2),
            overall_confidence: 0.7,
            competency_profiles: vec![
                CompetencyProfileWire {
                    competency: AssessmentCompetency::Fluency,
                    level: Some(CefrLevel::B2),
                    confidence: 0.8,
                    evidence: vec!["Maintained an extended response.".into()],
                },
                CompetencyProfileWire {
                    competency: AssessmentCompetency::Listening,
                    level: None,
                    confidence: 0.0,
                    evidence: vec![],
                },
            ],
        }
    }

    #[test]
    fn summary_happy_path_returns_recommendations() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(
                    200,
                    &json!({
                        "priorities": ["Practice linking ideas across longer answers."],
                        "recommendedSessions": ["storytelling with past tense"],
                        "notesForTutor": "Coverage was strong for fluency; listening remains unassessed."
                    })
                    .to_string(),
                ),
            ]);

            let result = synthesize_summary_text(&settings(base_url), summary_request())
                .await
                .expect("summary must succeed");
            server.join().expect("server must finish");

            assert_eq!(result.priorities.len(), 1);
            assert_eq!(result.recommended_sessions.len(), 1);
        });
    }

    #[test]
    fn summary_rejects_malformed_json_recoverably() {
        tauri::async_runtime::block_on(async {
            let (base_url, _rx, server) = mock_ollama(vec![
                version_fixture(),
                tags_fixture(),
                chat_fixture(200, "{ not json"),
            ]);

            let error = synthesize_summary_text(&settings(base_url), summary_request())
                .await
                .expect_err("malformed JSON must be rejected");
            server.join().expect("server must finish");

            assert_eq!(error.code, "invalid-response");
        });
    }

    #[test]
    fn generation_short_circuits_when_ollama_unavailable() {
        tauri::async_runtime::block_on(async {
            let error = generate_follow_up_turn(
                &settings("https://example.com".into()),
                follow_up_request(),
            )
            .await
            .expect_err("unreachable ollama must fail preflight");

            assert_eq!(error.code, "ollama-unavailable");
        });
    }
}
