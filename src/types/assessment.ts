import type { TutorPerformance } from "./tutor";
import type { ReviewItemDraft } from "./review";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type AssessmentCompetency =
  | "fluency"
  | "grammaticalRange"
  | "grammaticalAccuracy"
  | "lexicalResource"
  | "discourseManagement"
  | "interactiveCommunication"
  | "pronunciation"
  | "listening";

export type LanguageFunction =
  | "describe"
  | "narrate"
  | "explain"
  | "clarify"
  | "compare"
  | "justify"
  | "hypothesize"
  | "counterArgument"
  | "reformulate"
  | "negotiate"
  | "expressOpinion"
  | "qualifyStatement";

export type AssessmentTaskCategory =
  | "warm_up"
  | "personal_narrative"
  | "everyday_interaction"
  | "extended_production"
  | "professional_interaction"
  | "opinion"
  | "abstract_discussion"
  | "listening";

export type FollowUpIntent = LanguageFunction;

// --- FollowUpGenerator -----------------------------------------------

export type FollowUpConstraints = {
  requiresSpecialistKnowledge: boolean;
  maxQuestions: number;
};

export type FollowUpRequest = {
  targetCefr: string;
  followUpIntent: FollowUpIntent;
  previousQuestion: string;
  learnerAnswer: string;
  constraints: FollowUpConstraints;
};

export type FollowUpTurn = {
  question: string;
  performance?: TutorPerformance;
};

// --- EvidenceEvaluator --------------------------------------------------

export type CefrRange = {
  min: CefrLevel;
  max: CefrLevel;
};

export type EvaluateResponseRequest = {
  taskId: string;
  targetCefrRange: CefrRange;
  competencies: AssessmentCompetency[];
  requiredFunctions: LanguageFunction[];
  question: string;
  learnerAnswer: string;
};

export type CompetencyEvidenceResult = {
  competency: AssessmentCompetency;
  levelEvidence?: CefrLevel;
  confidence: number;
  evidence: string[];
  insufficientEvidence: boolean;
};

export type EvaluationResult = {
  competencyEvidence: CompetencyEvidenceResult[];
  performance?: TutorPerformance;
};

// --- ResultAggregator (client-side, deterministic) ----------------------

export type CompetencyProfile = {
  competency: AssessmentCompetency;
  level: CefrLevel | "insufficient_evidence";
  levelModifier?: "+" | "-";
  confidence: number;
};

export type AggregatedResult = {
  overallLevel: CefrLevel | "insufficient_evidence";
  overallLevelModifier?: "+" | "-";
  overallConfidence: number;
  competencyProfiles: CompetencyProfile[];
};

// --- SummarySynthesizer ---------------------------------------------

export type CompetencyProfileWire = {
  competency: AssessmentCompetency;
  level?: CefrLevel;
  confidence: number;
  evidence: string[];
};

export type SynthesizeSummaryRequest = {
  overallLevel?: CefrLevel;
  overallConfidence: number;
  competencyProfiles: CompetencyProfileWire[];
};

export type AssessmentSummaryText = {
  priorities: ReviewItemDraft[];
  recommendedSessions: string[];
  notesForTutor: string;
  performance?: TutorPerformance;
};

// --- Persistence ----------------------------------------------------

export type StartAssessmentRequest = {
  blueprintVersion: string;
  rubricVersion: string;
};

export type AssessmentStart = {
  assessmentId: number;
};

export type StartAssessmentTaskRunRequest = {
  assessmentId: number;
  taskId: string;
  targetCefrMin: CefrLevel;
  targetCefrMax: CefrLevel;
  difficulty: CefrLevel;
  anchorUsed: boolean;
};

export type AssessmentTaskRunStart = {
  taskRunId: number;
};

export type CompetencyEvidenceWrite = {
  competency: AssessmentCompetency;
  levelEvidence?: CefrLevel;
  confidence: number;
  evidence: string[];
};

export type RecordAssessmentTurnCycleRequest = {
  taskRunId: number;
  promptText: string;
  answerText: string;
  followUpIntent?: string;
  evidence: CompetencyEvidenceWrite[];
};

export type AssessmentTurnCycleResult = {
  answerTurnId: number;
};

export type CompleteAssessmentTaskRunRequest = {
  taskRunId: number;
  followUpsUsed: number;
};

export type CompleteAssessmentRequest = {
  assessmentId: number;
  estimatedLevel?: CefrLevel;
  confidence?: number;
};

export type AssessmentSummary = {
  id: number;
  startedAt: number;
  completedAt?: number;
  estimatedLevel?: CefrLevel;
  confidence?: number;
};

export type AssessmentEvidenceDetail = {
  competency: AssessmentCompetency;
  estimatedLevel?: CefrLevel;
  confidence: number;
  evidence: string[];
};

export type AssessmentTurnDetail = {
  id: number;
  role: "prompt" | "answer";
  text: string;
  followUpIntent?: string;
  timestamp: number;
  evidence: AssessmentEvidenceDetail[];
};

export type AssessmentTaskRunDetail = {
  id: number;
  taskId: string;
  targetCefrMin: CefrLevel;
  targetCefrMax: CefrLevel;
  difficulty: CefrLevel;
  anchorUsed: boolean;
  followUpsUsed: number;
  status: "in_progress" | "completed";
  turns: AssessmentTurnDetail[];
};

export type AssessmentDetail = {
  id: number;
  startedAt: number;
  completedAt?: number;
  blueprintVersion: string;
  rubricVersion: string;
  estimatedLevel?: CefrLevel;
  confidence?: number;
  taskRuns: AssessmentTaskRunDetail[];
};
