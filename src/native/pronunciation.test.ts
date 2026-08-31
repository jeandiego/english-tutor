import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PronunciationAttemptResult, PronunciationTarget } from "../types/pronunciation";
import {
  listPronunciationTargets,
  PronunciationError,
  submitPronunciationAttempt,
} from "./pronunciation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native pronunciation service", () => {
  it("lists pronunciation targets through the typed command", async () => {
    const targets: PronunciationTarget[] = [
      {
        id: 1,
        phrase: "I walked to the store",
        source: "session_summary",
        createdAt: 1_000,
        attemptCount: 0,
        isPromoted: false,
      },
    ];
    invokeMock.mockResolvedValue(targets);

    await expect(listPronunciationTargets(5)).resolves.toBe(targets);
    expect(invokeMock).toHaveBeenCalledWith("list_pronunciation_targets", { limit: 5 });
  });

  it("submits a pronunciation attempt through the typed command", async () => {
    const result: PronunciationAttemptResult = {
      attemptId: 9,
      isMatch: false,
      category: "final_consonants",
      diff: [{ op: "substituted", expected: "walked", heard: "walk" }],
      hint: "Try fully pronouncing the ending of \"walked\".",
      promoted: true,
    };
    invokeMock.mockResolvedValue(result);

    const request = {
      pronunciationTargetId: 1,
      transcript: "I walk to the store",
    };
    await expect(submitPronunciationAttempt(request)).resolves.toBe(result);
    expect(invokeMock).toHaveBeenCalledWith("submit_pronunciation_attempt", { request });
  });

  it("maps structured native failures to PronunciationError", async () => {
    invokeMock.mockRejectedValue({
      code: "not-found",
      message: "That pronunciation target no longer exists.",
      technicalMessage: "pronunciation_target 1 not found",
    });

    await expect(
      submitPronunciationAttempt({ pronunciationTargetId: 1, transcript: "hello" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PronunciationError>>({
        code: "not-found",
        message: "That pronunciation target no longer exists.",
        technicalMessage: "pronunciation_target 1 not found",
      }),
    );
  });
});
