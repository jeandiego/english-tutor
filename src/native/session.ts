import { invoke } from "@tauri-apps/api/core";
import type {
  OpenSessionRequest,
  OpeningTurn,
  SessionSummaryPayload,
  SynthesizeSessionSummaryRequest,
} from "../types/session";

export class SessionError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toSessionError(error: unknown): SessionError {
  if (error instanceof SessionError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The guided session could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new SessionError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new SessionError(
    "unknown",
    "The guided session could not continue.",
    technicalMessage,
  );
}

export async function openGuidedSession(
  request: OpenSessionRequest,
): Promise<OpeningTurn> {
  try {
    return await invoke<OpeningTurn>("open_guided_session", { request });
  } catch (error) {
    throw toSessionError(error);
  }
}

export async function synthesizeSessionSummary(
  request: SynthesizeSessionSummaryRequest,
): Promise<SessionSummaryPayload> {
  try {
    return await invoke<SessionSummaryPayload>("synthesize_session_summary", {
      request,
    });
  } catch (error) {
    throw toSessionError(error);
  }
}
