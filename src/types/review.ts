import type { TutorMessage, TutorPerformance } from "./tutor";

export type ReviewItemType =
  | "grammar_pattern"
  | "vocabulary"
  | "phrase"
  | "pronunciation_target"
  | "conversation_strategy";

export type ReviewSource =
  | "repair_event"
  | "session_summary"
  | "assessment_priority"
  | "writing_task";

export type ReviewOutcome = "remembered" | "partially_remembered" | "missed" | "skipped";

export type ReviewItem = {
  id: number;
  type: ReviewItemType;
  content: string;
  source: ReviewSource;
  stage: number;
  nextReviewAt: number;
  lastReviewedAt?: number;
  reviewCount: number;
  createdAt: number;
};

/** Emitted by session-summary and assessment-summary synthesis — the LLM
 * classifies each item's type itself at generation time. */
export type ReviewItemDraft = {
  content: string;
  type: ReviewItemType;
};

export type EvaluateReviewAttemptRequest = {
  itemType: ReviewItemType;
  content: string;
  transcript: string;
  history: TutorMessage[];
};

export type ReviewAttemptEvaluation = {
  outcome: ReviewOutcome;
  performance?: TutorPerformance;
};

export type RecordReviewOutcomeRequest = {
  reviewItemId: number;
  outcome: ReviewOutcome;
  sessionId?: number;
};

export type ReviewEventSummary = {
  reviewItemId: number;
  itemType: ReviewItemType;
  content: string;
  outcome: ReviewOutcome;
  sessionId?: number;
  createdAt: number;
};

/** Per-exchange review metadata attached by useTutorConversation, mirrors
 * ConversationRepairMeta. */
export type ConversationReviewMeta = {
  reviewItemId: number;
  itemType: ReviewItemType;
  content: string;
  outcome?: ReviewOutcome;
};
