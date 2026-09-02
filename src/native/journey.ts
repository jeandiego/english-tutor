import { invoke } from "@tauri-apps/api/core";
import type { JourneyCheckpoint } from "../types/journey";

export class JourneyError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "JourneyError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toJourneyError(error: unknown): JourneyError {
  if (error instanceof JourneyError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string" ? error.message : "Your journey could not be loaded.";
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    return new JourneyError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new JourneyError("unknown", "Your journey could not be loaded.", technicalMessage);
}

export async function listJourneyCheckpoints(limit?: number): Promise<JourneyCheckpoint[]> {
  try {
    return await invoke<JourneyCheckpoint[]>("list_journey_checkpoints", { limit });
  } catch (error) {
    throw toJourneyError(error);
  }
}
