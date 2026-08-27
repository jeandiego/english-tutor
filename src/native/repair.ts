import { invoke } from "@tauri-apps/api/core";
import type {
  EvaluateRepairRequest,
  RecordRepairEventRequest,
  RepairEvaluation,
  UpdateRepairEventOutcomeRequest,
} from "../types/repair";

export class RepairError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "RepairError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toRepairError(error: unknown): RepairError {
  if (error instanceof RepairError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The repair loop could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new RepairError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new RepairError(
    "unknown",
    "The repair loop could not continue.",
    technicalMessage,
  );
}

export async function evaluateRepairOpportunity(
  request: EvaluateRepairRequest,
): Promise<RepairEvaluation> {
  try {
    return await invoke<RepairEvaluation>("evaluate_repair_opportunity", {
      request,
    });
  } catch (error) {
    throw toRepairError(error);
  }
}

export async function recordRepairEvent(
  request: RecordRepairEventRequest,
): Promise<number> {
  try {
    return await invoke<number>("record_repair_event", { request });
  } catch (error) {
    throw toRepairError(error);
  }
}

export async function updateRepairEventOutcome(
  request: UpdateRepairEventOutcomeRequest,
): Promise<void> {
  try {
    await invoke<void>("update_repair_event_outcome", { request });
  } catch (error) {
    throw toRepairError(error);
  }
}
