import { invoke } from "@tauri-apps/api/core";
import type {
  ComprehensionCheck,
  GenerateComprehensionCheckRequest,
  ListeningCheckResult,
  SubmitListeningCheckAttemptRequest,
} from "../types/listening";

export class ListeningError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "ListeningError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toListeningError(error: unknown): ListeningError {
  if (error instanceof ListeningError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The comprehension check could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    return new ListeningError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new ListeningError(
    "unknown",
    "The comprehension check could not continue.",
    technicalMessage,
  );
}

export async function generateComprehensionCheck(
  request: GenerateComprehensionCheckRequest,
): Promise<ComprehensionCheck> {
  try {
    return await invoke<ComprehensionCheck>("generate_comprehension_check", { request });
  } catch (error) {
    throw toListeningError(error);
  }
}

export async function submitListeningCheckAttempt(
  request: SubmitListeningCheckAttemptRequest,
): Promise<ListeningCheckResult> {
  try {
    return await invoke<ListeningCheckResult>("submit_listening_check_attempt", { request });
  } catch (error) {
    throw toListeningError(error);
  }
}
