import { invoke } from "@tauri-apps/api/core";
import type {
  AcceptReadingChunksRequest,
  ReadingComprehensionResult,
  ReadingEvaluationResult,
  ReadingSessionAttempt,
  ReadingSessionDetail,
  StartReadingSessionRequest,
  SubmitReadingComprehensionAnswerRequest,
  SubmitReadingProductionRequest,
  SubmitReadingSpokenResponseRequest,
} from "../types/reading";
import type { LexicalChunk } from "../types/chunk";

export class ReadingError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "ReadingError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toReadingError(error: unknown): ReadingError {
  if (error instanceof ReadingError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The reading to writing request could not complete.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new ReadingError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new ReadingError(
    "unknown",
    "The reading to writing request could not complete.",
    technicalMessage,
  );
}

export async function startReadingSession(
  request: StartReadingSessionRequest,
): Promise<ReadingSessionAttempt> {
  try {
    return await invoke<ReadingSessionAttempt>("start_reading_session", { request });
  } catch (error) {
    throw toReadingError(error);
  }
}

export async function submitReadingComprehensionAnswer(
  request: SubmitReadingComprehensionAnswerRequest,
): Promise<ReadingComprehensionResult> {
  try {
    return await invoke<ReadingComprehensionResult>("submit_reading_comprehension_answer", {
      request,
    });
  } catch (error) {
    throw toReadingError(error);
  }
}

export async function acceptReadingChunks(
  request: AcceptReadingChunksRequest,
): Promise<LexicalChunk[]> {
  try {
    return await invoke<LexicalChunk[]>("accept_reading_chunks", { request });
  } catch (error) {
    throw toReadingError(error);
  }
}

export async function submitReadingProduction(
  request: SubmitReadingProductionRequest,
): Promise<ReadingEvaluationResult> {
  try {
    return await invoke<ReadingEvaluationResult>("submit_reading_production", { request });
  } catch (error) {
    throw toReadingError(error);
  }
}

export async function submitReadingSpokenResponse(
  request: SubmitReadingSpokenResponseRequest,
): Promise<void> {
  try {
    await invoke<void>("submit_reading_spoken_response", { request });
  } catch (error) {
    throw toReadingError(error);
  }
}

export async function getReadingSession(attemptId: number): Promise<ReadingSessionDetail> {
  try {
    return await invoke<ReadingSessionDetail>("get_reading_session", { attemptId });
  } catch (error) {
    throw toReadingError(error);
  }
}
