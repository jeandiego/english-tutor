import { invoke } from "@tauri-apps/api/core";
import type {
  AssessmentDetail,
  AssessmentStart,
  AssessmentSummary,
  AssessmentSummaryText,
  AssessmentTaskRunStart,
  AssessmentTurnCycleResult,
  CompleteAssessmentRequest,
  CompleteAssessmentTaskRunRequest,
  EvaluateResponseRequest,
  EvaluationResult,
  FollowUpRequest,
  FollowUpTurn,
  RecordAssessmentTurnCycleRequest,
  StartAssessmentRequest,
  StartAssessmentTaskRunRequest,
  SynthesizeSummaryRequest,
} from "../types/assessment";

export class AssessmentError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "AssessmentError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toAssessmentError(error: unknown): AssessmentError {
  if (error instanceof AssessmentError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The assessment could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new AssessmentError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new AssessmentError(
    "unknown",
    "The assessment could not continue.",
    technicalMessage,
  );
}

export async function generateFollowUp(
  request: FollowUpRequest,
): Promise<FollowUpTurn> {
  try {
    return await invoke<FollowUpTurn>("generate_follow_up", { request });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function evaluateResponse(
  request: EvaluateResponseRequest,
): Promise<EvaluationResult> {
  try {
    return await invoke<EvaluationResult>("evaluate_response", { request });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function synthesizeAssessmentSummary(
  request: SynthesizeSummaryRequest,
): Promise<AssessmentSummaryText> {
  try {
    return await invoke<AssessmentSummaryText>(
      "synthesize_assessment_summary",
      { request },
    );
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function startAssessment(
  request: StartAssessmentRequest,
): Promise<AssessmentStart> {
  try {
    return await invoke<AssessmentStart>("start_assessment", { request });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function startAssessmentTaskRun(
  request: StartAssessmentTaskRunRequest,
): Promise<AssessmentTaskRunStart> {
  try {
    return await invoke<AssessmentTaskRunStart>(
      "start_assessment_task_run",
      { request },
    );
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function recordAssessmentTurnCycle(
  request: RecordAssessmentTurnCycleRequest,
): Promise<AssessmentTurnCycleResult> {
  try {
    return await invoke<AssessmentTurnCycleResult>(
      "record_assessment_turn_cycle",
      { request },
    );
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function completeAssessmentTaskRun(
  request: CompleteAssessmentTaskRunRequest,
): Promise<void> {
  try {
    await invoke<void>("complete_assessment_task_run", { request });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function completeAssessment(
  request: CompleteAssessmentRequest,
): Promise<void> {
  try {
    await invoke<void>("complete_assessment", { request });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function getLatestAssessment(): Promise<AssessmentSummary | null> {
  try {
    return await invoke<AssessmentSummary | null>("get_latest_assessment");
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function listAssessments(
  limit?: number,
): Promise<AssessmentSummary[]> {
  try {
    return await invoke<AssessmentSummary[]>("list_assessments", { limit });
  } catch (error) {
    throw toAssessmentError(error);
  }
}

export async function getAssessmentDetail(
  assessmentId: number,
): Promise<AssessmentDetail | null> {
  try {
    return await invoke<AssessmentDetail | null>("get_assessment_detail", {
      assessmentId,
    });
  } catch (error) {
    throw toAssessmentError(error);
  }
}
