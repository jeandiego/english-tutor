import { invoke } from "@tauri-apps/api/core";
import type { RecordedAudio } from "../audio/recorder";
import type {
  TranscriptionResult,
  TranscriptionSettings,
  TranscriptionSetup,
} from "../types/transcription";

export class TranscriptionError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toTranscriptionError(error: unknown): TranscriptionError {
  if (error instanceof TranscriptionError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "Local transcription could not complete.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new TranscriptionError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new TranscriptionError(
    "unknown",
    "Local transcription could not complete.",
    technicalMessage,
  );
}

export async function loadTranscriptionSetup(): Promise<TranscriptionSetup> {
  try {
    return await invoke<TranscriptionSetup>("load_transcription_setup");
  } catch (error) {
    throw toTranscriptionError(error);
  }
}

export async function saveTranscriptionSettings(
  settings: TranscriptionSettings,
): Promise<TranscriptionSetup> {
  try {
    return await invoke<TranscriptionSetup>("save_transcription_settings", {
      settings,
    });
  } catch (error) {
    throw toTranscriptionError(error);
  }
}

export async function transcribeRecording(
  recording: RecordedAudio,
): Promise<TranscriptionResult> {
  const audioBytes = Array.from(new Uint8Array(await recording.blob.arrayBuffer()));

  try {
    return await invoke<TranscriptionResult>("transcribe_audio", {
      request: {
        audioBytes,
        mimeType: recording.mimeType,
      },
    });
  } catch (error) {
    throw toTranscriptionError(error);
  }
}
