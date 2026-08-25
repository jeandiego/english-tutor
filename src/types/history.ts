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
