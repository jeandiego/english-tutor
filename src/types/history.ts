import type { CefrLevel } from "./assessment";
import type { ListeningProfile } from "./listening";
import type { SessionRunStatus, SessionSummaryPayload } from "./session";
import type { ReviewItem, ReviewEventSummary } from "./review";
import type { BetterExpression, TutorCorrection, TutorMessage } from "./tutor";
import type { RepairIntensity, RepairMode, RepairOutcome, RepairPriority } from "./repair";

export type StartSessionRequest = {
  scenarioId?: string;
  difficulty?: CefrLevel;
  focus?: string;
  targetTurns?: number;
};

export type SessionStart = {
  sessionId: number;
  learnerContext?: string;
  dueReviewItems?: ReviewItem[];
  listeningProfile: ListeningProfile;
};

export type SessionSummary = {
  id: number;
  startedAt: number;
  endedAt: number;
  mode?: string;
  topic?: string;
  turnCount: number;
  status: SessionRunStatus;
  difficulty?: CefrLevel;
  summary?: SessionSummaryPayload;
  firstUserTurn?: string;
};

export type CompleteSessionRequest = {
  sessionId: number;
  status: SessionRunStatus;
  summary?: SessionSummaryPayload;
};

export type CategoryCount = {
  category: string;
  count: number;
};

export type ExpressionSummary = {
  original?: string;
  suggestion: string;
  explanation?: string;
  timestamp: number;
};

export type SessionRepairEventDetail = {
  id: number;
  priority: RepairPriority;
  issue: string;
  original: string;
  suggested: string;
  microExplanation: string;
  repairPrompt?: string;
  mode: RepairMode;
  outcome?: RepairOutcome;
  intensity: RepairIntensity;
  createdAt: number;
};

export type SessionTurnDetail = {
  id: number;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  corrections: TutorCorrection[];
  expressions: BetterExpression[];
  repairEvents: SessionRepairEventDetail[];
};

export type SessionDetail = {
  id: number;
  startedAt: number;
  endedAt: number;
  mode?: string;
  topic?: string;
  status: SessionRunStatus;
  difficulty?: CefrLevel;
  targetTurns?: number;
  continuedFromSessionId?: number;
  turns: SessionTurnDetail[];
  reviewEvents: ReviewEventSummary[];
  summary?: SessionSummaryPayload;
};

export type ConversationResumeContext = {
  sourceSessionId: number;
  continuationSessionId: number;
  recentMessages: TutorMessage[];
  priorSummary?: SessionSummaryPayload;
  learnerContext?: string;
  dueReviewItems?: ReviewItem[];
};

export type ConversationContinuePayload = {
  resume: ConversationResumeContext;
  sourceTitle: string;
  sourceStartedAt: number;
};
