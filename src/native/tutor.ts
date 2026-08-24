import { invoke } from "@tauri-apps/api/core";
import type {
  TutorSettings,
  TutorSetup,
  TutorTurn,
  TutorTurnRequest,
} from "../types/tutor";

export class TutorError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "TutorError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toTutorError(error: unknown): TutorError {
  if (error instanceof TutorError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The local tutor could not respond.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new TutorError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new TutorError(
    "unknown",
    "The local tutor could not respond.",
    technicalMessage,
  );
}

export async function loadTutorSetup(): Promise<TutorSetup> {
  try {
    return await invoke<TutorSetup>("load_tutor_setup");
  } catch (error) {
    throw toTutorError(error);
  }
}

export async function saveTutorSettings(
  settings: TutorSettings,
): Promise<TutorSetup> {
  try {
    return await invoke<TutorSetup>("save_tutor_settings", { settings });
  } catch (error) {
    throw toTutorError(error);
  }
}

export async function requestTutorTurn(
  request: TutorTurnRequest,
): Promise<TutorTurn> {
  try {
    return await invoke<TutorTurn>("generate_tutor_turn", { request });
  } catch (error) {
    throw toTutorError(error);
  }
}
