import type { CefrLevel } from "./assessment";
import type { TutorPerformance } from "./tutor";

export type WritingTaskType =
  | "professional_email"
  | "opinion_paragraph"
  | "technical_explanation"
  | "summary"
  | "recommendation"
  | "short_argument";

export type WritingDimension =
  | "taskAchievement"
  | "coherenceCohesion"
  | "lexicalResource"
  | "grammar"
  | "registerTone";

export type WritingEvaluationStage = "draft" | "rewrite";

export type WritingTaskStatus = "drafting" | "draft_evaluated" | "rewrite_evaluated";

export type WritingTaskBlueprint = {
  taskType: WritingTaskType;
  label: string;
  communicativeGoal: string;
  targetLevel: CefrLevel;
  suggestedWordMin: number;
  suggestedWordMax: number;
  successCriteria: string[];
  recommendedChunks: string[];
  rubric: string;
};

export type DimensionScoreResult = {
  dimension: WritingDimension;
  level: CefrLevel;
  evidence: string;
};

export type PriorityIssueResult = {
  category: WritingDimension;
  original: string;
  suggested: string;
  explanation: string;
};

export type UsefulChunkResult = {
  chunk: string;
  register: string;
  example: string;
};

export type WritingEvaluationResult = {
  id: number;
  stage: WritingEvaluationStage;
  overallLevel: CefrLevel;
  rewriteInstruction: string;
  dimensions: DimensionScoreResult[];
  priorityIssues: PriorityIssueResult[];
  usefulChunks: UsefulChunkResult[];
  performance?: TutorPerformance;
};

export type WritingTask = {
  id: number;
  taskType: WritingTaskType;
  targetLevel: CefrLevel;
  status: WritingTaskStatus;
  createdAt: number;
};

export type WritingTaskDetail = {
  id: number;
  taskType: WritingTaskType;
  targetLevel: CefrLevel;
  status: WritingTaskStatus;
  draftText?: string;
  rewriteText?: string;
  createdAt: number;
  draftEvaluation?: WritingEvaluationResult;
  rewriteEvaluation?: WritingEvaluationResult;
};

export type WritingTaskSummary = {
  id: number;
  taskType: WritingTaskType;
  status: WritingTaskStatus;
  draftOverallLevel?: CefrLevel;
  rewriteOverallLevel?: CefrLevel;
  createdAt: number;
};

export type WritingComparisonResult = {
  draftEvaluation: WritingEvaluationResult;
  rewriteEvaluation: WritingEvaluationResult;
  learnerProfileWarning?: string;
};

export type StartWritingTaskRequest = {
  taskType: WritingTaskType;
};

export type SubmitWritingDraftRequest = {
  writingTaskId: number;
  taskType: WritingTaskType;
  draftText: string;
};

export type SubmitWritingRewriteRequest = {
  writingTaskId: number;
  taskType: WritingTaskType;
  rewriteText: string;
};
