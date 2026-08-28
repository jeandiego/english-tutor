import type { AssessmentCompetency, CefrLevel } from "./assessment";
import type { ReviewItemDraft } from "./review";

export type LearnerIssue = {
  category: string;
  label: string;
  count: number;
};

export type VocabularyItem = {
  original?: string;
  suggestion: string;
  explanation?: string;
  timestamp: number;
};

export type PronunciationTarget = {
  label: string;
};

export type ProgressNoteOrigin = "assessment" | "session";

export type ProgressNote = {
  text: string;
  origin: ProgressNoteOrigin;
  createdAt: number;
};

export type LearnerProfile = {
  currentLevel?: CefrLevel;
  dimensionLevels: Partial<Record<AssessmentCompetency, CefrLevel>>;
  goals: string[];
  preferredScenarios: string[];
  targetAccents: string[];
  recurringIssues: LearnerIssue[];
  activeVocabulary: VocabularyItem[];
  activeGrammarTargets: LearnerIssue[];
  activePronunciationTargets: PronunciationTarget[];
  progressNotes: ProgressNote[];
};

export type SaveLearnerProfilePreferencesRequest = {
  goals: string[];
  preferredScenarios: string[];
  targetAccents: string[];
};

export type ApplyAssessmentToLearnerProfileRequest = {
  overallLevel?: CefrLevel;
  dimensionLevels: Partial<Record<AssessmentCompetency, CefrLevel>>;
  priorities: ReviewItemDraft[];
  assessmentId?: number;
};
