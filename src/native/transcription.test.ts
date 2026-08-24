import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedAudio } from "../audio/recorder";
import {
  loadTranscriptionSetup,
  saveTranscriptionSettings,
  transcribeRecording,
  TranscriptionError,
} from "./transcription";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function recording(): RecordedAudio {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3])], {
      type: "audio/webm;codecs=opus",
    }),
    playbackUrl: "blob:audio",
    durationMs: 1200,
    mimeType: "audio/webm;codecs=opus",
    sizeBytes: 3,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native transcription service", () => {
  it("loads and saves native settings through typed commands", async () => {
    const setup = {
      settings: {
        whisperExecutablePath: "/bin/whisper-cli",
        whisperModelPath: "/models/english.bin",
        ffmpegExecutablePath: "ffmpeg",
      },
      preflight: { status: "ready" as const, checks: [] },
    };
    invokeMock.mockResolvedValue(setup);

    await expect(loadTranscriptionSetup()).resolves.toBe(setup);
    await expect(saveTranscriptionSettings(setup.settings)).resolves.toBe(setup);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_transcription_setup");
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "save_transcription_settings",
      { settings: setup.settings },
    );
  });

  it("serializes Blob bytes and MIME type without executable arguments", async () => {
    invokeMock.mockResolvedValue({ text: "A local transcript." });

    await expect(transcribeRecording(recording())).resolves.toEqual({
      text: "A local transcript.",
    });

    expect(invokeMock).toHaveBeenCalledWith("transcribe_audio", {
      request: {
        audioBytes: [1, 2, 3],
        mimeType: "audio/webm;codecs=opus",
      },
    });
  });

  it("maps structured native failures to TranscriptionError", async () => {
    invokeMock.mockRejectedValue({
      code: "conversion-failed",
      message: "Audio conversion failed.",
      technicalMessage: "ffmpeg exited with status 1",
    });

    await expect(transcribeRecording(recording())).rejects.toEqual(
      expect.objectContaining<Partial<TranscriptionError>>({
        code: "conversion-failed",
        message: "Audio conversion failed.",
        technicalMessage: "ffmpeg exited with status 1",
      }),
    );
  });
});
