import type { CefrLevel } from "./assessment";
import type { SessionRunStatus, SessionSummaryPayload } from "./session";

export type StartSessionRequest = {
  scenarioId?: string;
  difficulty?: CefrLevel;
  focus?: string;
  targetTurns?: number;
};

export type SessionStart = {
  sessionId: number;
  learnerContext?: string;
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
