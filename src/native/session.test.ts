import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpeningTurn, SessionSummaryPayload } from "../types/session";
import { openGuidedSession, SessionError, synthesizeSessionSummary } from "./session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native session service", () => {
  it("opens a guided session through the typed command", async () => {
    const opening: OpeningTurn = { opening: "Let's do a quick standup." };
    invokeMock.mockResolvedValue(opening);

    const request = { scenarioSystemPrompt: "Daily standup.", learnerContext: "B1 learner." };
    await expect(openGuidedSession(request)).resolves.toBe(opening);
    expect(invokeMock).toHaveBeenCalledWith("open_guided_session", { request });
  });

  it("synthesizes a session summary through the typed command", async () => {
    const summary: SessionSummaryPayload = {
      whatWentWell: ["Gave a clear update."],
      priorityIssues: ["past tense accuracy"],
      alternativePhrases: [],
      reviewItems: ["past tense forms"],
      repairEvents: [],
    };
    invokeMock.mockResolvedValue(summary);

    const request = {
      scenarioLabel: "Daily standup",
      turns: [{ role: "user" as const, content: "I finished the auth work." }],
      corrections: [],
      betterExpressions: [],
      repairEvents: [],
    };
    await expect(synthesizeSessionSummary(request)).resolves.toBe(summary);
    expect(invokeMock).toHaveBeenCalledWith("synthesize_session_summary", { request });
  });

  it("maps structured native failures to SessionError", async () => {
    invokeMock.mockRejectedValue({
      code: "invalid-response",
      message: "The local tutor returned invalid structured output.",
      technicalMessage: "priorityIssues was empty",
    });

    await expect(
      openGuidedSession({ scenarioSystemPrompt: "Restaurant." }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SessionError>>({
        code: "invalid-response",
        message: "The local tutor returned invalid structured output.",
        technicalMessage: "priorityIssues was empty",
      }),
    );
  });
});
