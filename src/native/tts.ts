import { invoke } from "@tauri-apps/api/core";
import type { TtsSettings, TtsSetup } from "../types/tts";

export class TtsError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toTtsError(error: unknown): TtsError {
  if (error instanceof TtsError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The voice settings could not be loaded.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new TtsError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new TtsError(
    "unknown",
    "The voice settings could not be loaded.",
    technicalMessage,
  );
}

export async function loadTtsSetup(): Promise<TtsSetup> {
  try {
    return await invoke<TtsSetup>("load_tts_setup");
  } catch (error) {
    throw toTtsError(error);
  }
}

export async function saveTtsSettings(settings: TtsSettings): Promise<TtsSetup> {
  try {
    return await invoke<TtsSetup>("save_tts_settings", { settings });
  } catch (error) {
    throw toTtsError(error);
  }
}
