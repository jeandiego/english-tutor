import { invoke } from "@tauri-apps/api/core";
import type {
  PronunciationAttemptResult,
  PronunciationTarget,
  SubmitPronunciationAttemptRequest,
} from "../types/pronunciation";

export class PronunciationError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "PronunciationError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toPronunciationError(error: unknown): PronunciationError {
  if (error instanceof PronunciationError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The pronunciation practice loop could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new PronunciationError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new PronunciationError(
    "unknown",
    "The pronunciation practice loop could not continue.",
    technicalMessage,
  );
}

export async function listPronunciationTargets(
  limit?: number,
): Promise<PronunciationTarget[]> {
  try {
    return await invoke<PronunciationTarget[]>("list_pronunciation_targets", {
      limit,
    });
  } catch (error) {
    throw toPronunciationError(error);
  }
}

export async function submitPronunciationAttempt(
  request: SubmitPronunciationAttemptRequest,
): Promise<PronunciationAttemptResult> {
  try {
    return await invoke<PronunciationAttemptResult>("submit_pronunciation_attempt", {
      request,
    });
  } catch (error) {
    throw toPronunciationError(error);
  }
}
