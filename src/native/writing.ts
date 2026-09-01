import { invoke } from "@tauri-apps/api/core";
import type {
  StartWritingTaskRequest,
  SubmitWritingDraftRequest,
  SubmitWritingRewriteRequest,
  WritingComparisonResult,
  WritingEvaluationResult,
  WritingTask,
  WritingTaskBlueprint,
  WritingTaskDetail,
  WritingTaskSummary,
} from "../types/writing";

export class WritingError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "WritingError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toWritingError(error: unknown): WritingError {
  if (error instanceof WritingError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The writing gym request could not complete.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new WritingError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new WritingError(
    "unknown",
    "The writing gym request could not complete.",
    technicalMessage,
  );
}

export async function listWritingTaskTypes(): Promise<WritingTaskBlueprint[]> {
  try {
    return await invoke<WritingTaskBlueprint[]>("list_writing_task_types");
  } catch (error) {
    throw toWritingError(error);
  }
}

export async function startWritingTask(
  request: StartWritingTaskRequest,
): Promise<WritingTask> {
  try {
    return await invoke<WritingTask>("start_writing_task", { request });
  } catch (error) {
    throw toWritingError(error);
  }
}

export async function submitWritingDraft(
  request: SubmitWritingDraftRequest,
): Promise<WritingEvaluationResult> {
  try {
    return await invoke<WritingEvaluationResult>("submit_writing_draft", { request });
  } catch (error) {
    throw toWritingError(error);
  }
}

export async function submitWritingRewrite(
  request: SubmitWritingRewriteRequest,
): Promise<WritingComparisonResult> {
  try {
    return await invoke<WritingComparisonResult>("submit_writing_rewrite", { request });
  } catch (error) {
    throw toWritingError(error);
  }
}

export async function getWritingTask(writingTaskId: number): Promise<WritingTaskDetail> {
  try {
    return await invoke<WritingTaskDetail>("get_writing_task", { writingTaskId });
  } catch (error) {
    throw toWritingError(error);
  }
}

export async function listWritingTasks(limit?: number): Promise<WritingTaskSummary[]> {
  try {
    return await invoke<WritingTaskSummary[]>("list_writing_tasks", { limit });
  } catch (error) {
    throw toWritingError(error);
  }
}
