import type { BetterExpression, TutorMessage, TutorCorrection } from "./tutor";
import type { RepairEventSummary } from "./repair";
import type { ReviewItemDraft } from "./review";

export type SessionRunStatus = "active" | "completed" | "abandoned";

export type OpenSessionRequest = {
  scenarioSystemPrompt: string;
  learnerContext?: string;
  listeningStage?: number;
};

export type OpeningTurn = {
  opening: string;
};

export type SessionSummaryPayload = {
  whatWentWell: string[];
  priorityIssues: string[];
  alternativePhrases: BetterExpression[];
  reviewItems: ReviewItemDraft[];
  repairEvents: RepairEventSummary[];
};

export type SynthesizeSessionSummaryRequest = {
  scenarioLabel: string;
  turns: TutorMessage[];
  corrections: TutorCorrection[];
  betterExpressions: BetterExpression[];
  repairEvents: RepairEventSummary[];
};

export type ApplySessionToLearnerProfileRequest = {
  scenarioLabel: string;
  priorities: string[];
};
