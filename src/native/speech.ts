import { invoke } from "@tauri-apps/api/core";
import type { TtsProviderId } from "../types/tts";

export type SpeechOverrides = {
  provider?: TtsProviderId;
  voiceId?: string;
  rate?: number;
};

export class SpeechError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "SpeechError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toSpeechError(error: unknown): SpeechError {
  if (error instanceof SpeechError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The tutor reply could not be spoken.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new SpeechError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new SpeechError(
    "unknown",
    "The tutor reply could not be spoken.",
    technicalMessage,
  );
}

export async function speakTutorReply(
  reply: string,
  overrides?: SpeechOverrides,
): Promise<void> {
  try {
    await invoke("speak_tutor_reply", {
      request: {
        reply,
        provider: overrides?.provider,
        voiceId: overrides?.voiceId,
        rate: overrides?.rate,
      },
    });
  } catch (error) {
    throw toSpeechError(error);
  }
}
