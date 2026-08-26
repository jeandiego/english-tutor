import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationResult, FollowUpTurn } from "../types/assessment";
import {
  AssessmentError,
  evaluateResponse,
  generateFollowUp,
  getLatestAssessment,
  listAssessments,
  recordAssessmentTurnCycle,
  startAssessment,
  toAssessmentError,
} from "./assessment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native assessment service", () => {
  it("requests a follow-up question through the typed command", async () => {
    const turn: FollowUpTurn = {
      question: "What would you say to someone who disagrees?",
    };
    invokeMock.mockResolvedValue(turn);

    const request = {
      targetCefr: "B2-C1",
      followUpIntent: "counterArgument" as const,
      previousQuestion: "Tell me about a decision you made.",
      learnerAnswer: "We migrated the stack.",
      constraints: { requiresSpecialistKnowledge: false, maxQuestions: 1 },
    };

    await expect(generateFollowUp(request)).resolves.toBe(turn);
    expect(invokeMock).toHaveBeenCalledWith("generate_follow_up", { request });
  });

  it("requests evidence evaluation through the typed command", async () => {
    const result: EvaluationResult = {
      competencyEvidence: [
        {
          competency: "fluency",
          levelEvidence: "B2",
          confidence: 0.8,
          evidence: ["Maintained an extended response."],
          insufficientEvidence: false,
        },
      ],
    };
    invokeMock.mockResolvedValue(result);

    const request = {
      taskId: "extended_production.technical_decision.v1",
      targetCefrRange: { min: "B2" as const, max: "C1" as const },
      competencies: ["fluency" as const],
      requiredFunctions: ["explain" as const],
      question: "Tell me about a decision you made.",
      learnerAnswer: "We migrated the stack.",
    };

    await expect(evaluateResponse(request)).resolves.toBe(result);
    expect(invokeMock).toHaveBeenCalledWith("evaluate_response", { request });
  });

  it("starts an assessment and lists results through typed commands", async () => {
    invokeMock.mockResolvedValueOnce({ assessmentId: 1 });
    invokeMock.mockResolvedValueOnce([
      { id: 1, startedAt: 1000, estimatedLevel: "B2", confidence: 0.7 },
    ]);
    invokeMock.mockResolvedValueOnce(null);

    await expect(
      startAssessment({ blueprintVersion: "v1", rubricVersion: "v1" }),
    ).resolves.toEqual({ assessmentId: 1 });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "start_assessment", {
      request: { blueprintVersion: "v1", rubricVersion: "v1" },
    });

    await expect(listAssessments(5)).resolves.toHaveLength(1);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_assessments", {
      limit: 5,
    });

    await expect(getLatestAssessment()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenNthCalledWith(3, "get_latest_assessment");
  });

  it("records a turn cycle with prompt, answer, and evidence", async () => {
    invokeMock.mockResolvedValue({ answerTurnId: 42 });

    const request = {
      taskRunId: 7,
      promptText: "Tell me about a decision you made.",
      answerText: "We migrated the stack.",
      evidence: [
        {
          competency: "fluency" as const,
          levelEvidence: "B2" as const,
          confidence: 0.8,
          evidence: ["Maintained an extended response."],
        },
      ],
    };

    await expect(recordAssessmentTurnCycle(request)).resolves.toEqual({
      answerTurnId: 42,
    });
    expect(invokeMock).toHaveBeenCalledWith("record_assessment_turn_cycle", {
      request,
    });
  });

  it("maps structured native failures to AssessmentError", async () => {
    invokeMock.mockRejectedValue({
      code: "invalid-response",
      message: "The assessment model returned invalid structured output.",
      technicalMessage: "missing field question",
    });

    await expect(
      generateFollowUp({
        targetCefr: "B2-C1",
        followUpIntent: "counterArgument",
        previousQuestion: "q",
        learnerAnswer: "a",
        constraints: { requiresSpecialistKnowledge: false, maxQuestions: 1 },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AssessmentError>>({
        code: "invalid-response",
        message: "The assessment model returned invalid structured output.",
        technicalMessage: "missing field question",
      }),
    );
  });

  it("normalizes unknown thrown values via toAssessmentError", () => {
    const error = toAssessmentError(new Error("boom"));
    expect(error).toBeInstanceOf(AssessmentError);
    expect(error.code).toBe("unknown");
    expect(error.technicalMessage).toBe("boom");
  });
});
