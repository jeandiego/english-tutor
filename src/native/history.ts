import { invoke } from "@tauri-apps/api/core";
import type {
  CategoryCount,
  CompleteSessionRequest,
  ExpressionSummary,
  SessionStart,
  SessionSummary,
  StartSessionRequest,
} from "../types/history";

export class HistoryError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "HistoryError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toHistoryError(error: unknown): HistoryError {
  if (error instanceof HistoryError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The learning history is unavailable.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new HistoryError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new HistoryError(
    "unknown",
    "The learning history is unavailable.",
    technicalMessage,
  );
}

export async function startSession(
  request: StartSessionRequest = {},
): Promise<SessionStart> {
  try {
    return await invoke<SessionStart>("start_session", { request });
  } catch (error) {
    throw toHistoryError(error);
  }
}

export async function completeSession(
  request: CompleteSessionRequest,
): Promise<void> {
  try {
    await invoke("complete_session", { request });
  } catch (error) {
    throw toHistoryError(error);
  }
}

export async function listRecentSessions(
  limit?: number,
): Promise<SessionSummary[]> {
  try {
    return await invoke<SessionSummary[]>("list_recent_sessions", { limit });
  } catch (error) {
    throw toHistoryError(error);
  }
}

export async function listCorrectionCategoryCounts(): Promise<CategoryCount[]> {
  try {
    return await invoke<CategoryCount[]>("list_correction_category_counts");
  } catch (error) {
    throw toHistoryError(error);
  }
}

export async function listRecentExpressions(
  limit?: number,
): Promise<ExpressionSummary[]> {
  try {
    return await invoke<ExpressionSummary[]>("list_recent_expressions", {
      limit,
    });
  } catch (error) {
    throw toHistoryError(error);
  }
}
