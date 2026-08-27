import type { RepairIntensity, TutorMessage, TutorPerformance } from "./tutor";

export type { RepairIntensity };

export type RepairPriority =
  | "grammar"
  | "vocabulary"
  | "pronunciation"
  | "fluency"
  | "coherence"
  | "pragmatics";

export type RepairMode = "implicit" | "quick" | "repair";

export type RepairOutcome = "improved" | "failed" | "skipped";

export type PendingRepairContext = {
  priority: RepairPriority;
  issue: string;
  original: string;
  suggested: string;
};

export type EvaluateRepairRequest = {
  transcript: string;
  history: TutorMessage[];
  learnerContext?: string;
  intensity: RepairIntensity;
  pendingRepair?: PendingRepairContext;
};

export type RepairEvaluation = {
  shouldIntervene: boolean;
  priority?: RepairPriority;
  issue?: string;
  original?: string;
  suggested?: string;
  microExplanation?: string;
  repairPrompt?: string;
  reason?: string;
  repairOutcome?: "improved" | "failed";
  performance?: TutorPerformance;
};

export type RecordRepairEventRequest = {
  turnId: number;
  priority: RepairPriority;
  issue: string;
  original: string;
  suggested: string;
  microExplanation: string;
  repairPrompt?: string;
  mode: RepairMode;
  intensity: RepairIntensity;
};

export type UpdateRepairEventOutcomeRequest = {
  eventId: number;
  outcome: RepairOutcome;
};

export type RepairEventSummary = {
  priority: RepairPriority;
  issue: string;
  mode: RepairMode;
  outcome?: RepairOutcome;
};

/** Per-exchange repair metadata attached by useTutorConversation. */
export type ConversationRepairMeta = {
  priority: RepairPriority;
  issue: string;
  original: string;
  suggested: string;
  microExplanation: string;
  repairPrompt?: string;
  mode: RepairMode;
  eventId?: number;
  outcome?: RepairOutcome;
};
