import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { speakTutorReply, SpeechError } from "./speech";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native speech service", () => {
  it("speaks a tutor reply through the typed native command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(speakTutorReply("Only this reply is spoken.")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("speak_tutor_reply", {
      request: { reply: "Only this reply is spoken." },
    });
  });

  it("maps structured native failures to SpeechError", async () => {
    invokeMock.mockRejectedValue({
      code: "speech-failed",
      message: "macOS speech could not play the tutor reply.",
      technicalMessage: "exit status: 1",
    });

    await expect(speakTutorReply("Hello")).rejects.toEqual(
      expect.objectContaining<Partial<SpeechError>>({
        code: "speech-failed",
        message: "macOS speech could not play the tutor reply.",
        technicalMessage: "exit status: 1",
      }),
    );
  });
});
