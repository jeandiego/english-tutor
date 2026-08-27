import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepairEvaluation } from "../types/repair";
import {
  evaluateRepairOpportunity,
  RepairError,
  recordRepairEvent,
  updateRepairEventOutcome,
} from "./repair";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native repair service", () => {
  it("evaluates a repair opportunity through the typed command", async () => {
    const evaluation: RepairEvaluation = {
      shouldIntervene: true,
      priority: "grammar",
      issue: "past tense form",
      original: "Yesterday I go to the office",
      suggested: "Yesterday I went to the office",
      microExplanation: "Use past tense for a finished action.",
      repairPrompt: "Try that sentence again using 'went'.",
    };
    invokeMock.mockResolvedValue(evaluation);

    const request = {
      transcript: "Yesterday I go to the office",
      history: [],
      intensity: "balanced" as const,
    };
    await expect(evaluateRepairOpportunity(request)).resolves.toBe(evaluation);
    expect(invokeMock).toHaveBeenCalledWith("evaluate_repair_opportunity", { request });
  });

  it("records a repair event through the typed command", async () => {
    invokeMock.mockResolvedValue(42);

    const request = {
      turnId: 7,
      priority: "grammar" as const,
      issue: "past tense form",
      original: "Yesterday I go to the office",
      suggested: "Yesterday I went to the office",
      microExplanation: "Use past tense for a finished action.",
      repairPrompt: "Try that sentence again using 'went'.",
      mode: "repair" as const,
      intensity: "balanced" as const,
    };
    await expect(recordRepairEvent(request)).resolves.toBe(42);
    expect(invokeMock).toHaveBeenCalledWith("record_repair_event", { request });
  });

  it("updates a repair event outcome through the typed command", async () => {
    invokeMock.mockResolvedValue(undefined);

    const request = { eventId: 42, outcome: "improved" as const };
    await updateRepairEventOutcome(request);
    expect(invokeMock).toHaveBeenCalledWith("update_repair_event_outcome", { request });
  });

  it("maps structured native failures to RepairError", async () => {
    invokeMock.mockRejectedValue({
      code: "invalid-response",
      message: "The local tutor returned invalid structured output.",
      technicalMessage: "repairOutcome was missing",
    });

    await expect(
      evaluateRepairOpportunity({
        transcript: "Yesterday I went to the office",
        history: [],
        intensity: "balanced",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RepairError>>({
        code: "invalid-response",
        message: "The local tutor returned invalid structured output.",
        technicalMessage: "repairOutcome was missing",
      }),
    );
  });
});
