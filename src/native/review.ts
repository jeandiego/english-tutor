import { invoke } from "@tauri-apps/api/core";
import type {
  EvaluateReviewAttemptRequest,
  RecordReviewOutcomeRequest,
  ReviewAttemptEvaluation,
  ReviewEventSummary,
  ReviewItem,
} from "../types/review";

export class ReviewError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toReviewError(error: unknown): ReviewError {
  if (error instanceof ReviewError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The review loop could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new ReviewError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new ReviewError(
    "unknown",
    "The review loop could not continue.",
    technicalMessage,
  );
}

export async function listDueReviewItems(limit?: number): Promise<ReviewItem[]> {
  try {
    return await invoke<ReviewItem[]>("list_due_review_items", { limit });
  } catch (error) {
    throw toReviewError(error);
  }
}

export async function evaluateReviewAttempt(
  request: EvaluateReviewAttemptRequest,
): Promise<ReviewAttemptEvaluation> {
  try {
    return await invoke<ReviewAttemptEvaluation>("evaluate_review_attempt", {
      request,
    });
  } catch (error) {
    throw toReviewError(error);
  }
}

export async function recordReviewOutcome(
  request: RecordReviewOutcomeRequest,
): Promise<void> {
  try {
    await invoke<void>("record_review_outcome", { request });
  } catch (error) {
    throw toReviewError(error);
  }
}

export async function listRecentReviewEvents(
  limit?: number,
): Promise<ReviewEventSummary[]> {
  try {
    return await invoke<ReviewEventSummary[]>("list_recent_review_events", {
      limit,
    });
  } catch (error) {
    throw toReviewError(error);
  }
}
