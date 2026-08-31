import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComprehensionCheck, ListeningCheckResult } from "../types/listening";
import { generateComprehensionCheck, ListeningError, submitListeningCheckAttempt } from "./listening";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native listening service", () => {
  it("generates a comprehension check through the typed command", async () => {
    const check: ComprehensionCheck = {
      id: 1,
      checkType: "detail_question",
      question: "What time does the train leave?",
    };
    invokeMock.mockResolvedValue(check);

    const request = {
      tutorReply: "The train leaves at six.",
      stage: 0,
    };
    await expect(generateComprehensionCheck(request)).resolves.toBe(check);
    expect(invokeMock).toHaveBeenCalledWith("generate_comprehension_check", { request });
  });

  it("submits a listening check attempt through the typed command", async () => {
    const result: ListeningCheckResult = {
      isCorrect: true,
      feedback: "Correct.",
      newStage: 1,
    };
    invokeMock.mockResolvedValue(result);

    const request = { checkId: 1, answer: "Six o'clock" };
    await expect(submitListeningCheckAttempt(request)).resolves.toBe(result);
    expect(invokeMock).toHaveBeenCalledWith("submit_listening_check_attempt", { request });
  });

  it("maps structured native failures to ListeningError", async () => {
    invokeMock.mockRejectedValue({
      code: "not-found",
      message: "That comprehension check no longer exists.",
      technicalMessage: "listening_check 1 not found",
    });

    await expect(
      submitListeningCheckAttempt({ checkId: 1, answer: "hello" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ListeningError>>({
        code: "not-found",
        message: "That comprehension check no longer exists.",
        technicalMessage: "listening_check 1 not found",
      }),
    );
  });
});
