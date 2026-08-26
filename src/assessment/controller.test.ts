import { describe, expect, it } from "vitest";
import type { AssessmentCompetency, CefrLevel, CompetencyEvidenceResult } from "../types/assessment";
import { BLUEPRINT_TASKS } from "./blueprint";
import {
  MAX_TURNS,
  adjustDifficulty,
  applyEvidence,
  beginTaskRun,
  completeCurrentTaskRun,
  createInitialState,
  recordFollowUp,
  requiredStopCompetencies,
  selectNextStep,
} from "./controller";
import type { AssessmentTask } from "./types";

const TEST_TASKS: AssessmentTask[] = [
  {
    id: "task-a",
    category: "personal_narrative",
    cefrRange: { min: "B1", max: "B2" },
    competencies: ["fluency"],
    requiredFunctions: ["narrate"],
    anchorPrompt: "Tell me about your day.",
    followUpPolicy: { min: 1, max: 2, allowedIntents: ["clarify", "reformulate"] },
  },
  {
    id: "task-b",
    category: "opinion",
    cefrRange: { min: "B2", max: "C1" },
    competencies: ["lexicalResource"],
    requiredFunctions: ["justify"],
    anchorPrompt: "What's your opinion on X?",
    followUpPolicy: { min: 0, max: 1, allowedIntents: ["counterArgument"] },
  },
  {
    id: "task-c",
    category: "everyday_interaction",
    cefrRange: { min: "A2", max: "B1" },
    competencies: ["interactiveCommunication"],
    requiredFunctions: ["clarify"],
    anchorPrompt: "How would you ask for help?",
    followUpPolicy: { min: 0, max: 1, allowedIntents: ["clarify"] },
  },
];

function evidenceResult(
  competency: AssessmentCompetency,
  level: CefrLevel | null,
  confidence: number,
): CompetencyEvidenceResult {
  return {
    competency,
    levelEvidence: level ?? undefined,
    confidence,
    evidence: level ? ["some evidence"] : [],
    insufficientEvidence: level === null,
  };
}

describe("requiredStopCompetencies", () => {
  it("excludes competencies no task can produce evidence for", () => {
    const required = requiredStopCompetencies(TEST_TASKS);
    expect(required).not.toContain("listening");
    expect(required).not.toContain("pronunciation");
    expect(required).toEqual(
      expect.arrayContaining(["fluency", "lexicalResource", "interactiveCommunication"]),
    );
  });

  it("the real blueprint requests pronunciation evidence but stubs listening", () => {
    const required = requiredStopCompetencies(BLUEPRINT_TASKS);
    expect(required).toContain("pronunciation");
    expect(required).not.toContain("listening");
  });
});

describe("selectNextStep — cold start", () => {
  it("starts around B1/B2, never A1", () => {
    const state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    expect(state.currentDifficulty).not.toBe("A1");

    const step = selectNextStep(state);
    expect(step.kind).toBe("anchor");
  });
});

describe("adjustDifficulty", () => {
  it("raises difficulty after strong at-or-above evidence", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1"); // B2
    state = adjustDifficulty(state, [evidenceResult("fluency", "C1", 0.9)]);
    expect(state.currentDifficulty).toBe("C1");
  });

  it("lowers difficulty on weak evidence, progressing toward A1", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1"); // B2
    state = adjustDifficulty(state, [evidenceResult("fluency", "A1", 0.9)]);
    expect(state.currentDifficulty).toBe("B1");
    state = adjustDifficulty(state, [evidenceResult("fluency", "A1", 0.9)]);
    expect(state.currentDifficulty).toBe("A2");
    state = adjustDifficulty(state, [evidenceResult("fluency", "A1", 0.9)]);
    expect(state.currentDifficulty).toBe("A1");
  });

  it("does not move difficulty when evidence is below the strong-confidence threshold", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1"); // B2
    state = adjustDifficulty(state, [evidenceResult("fluency", "C1", 0.4)]);
    expect(state.currentDifficulty).toBe("B2");
  });

  it("does not move difficulty when insufficientEvidence is true", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1"); // B2
    state = adjustDifficulty(state, [evidenceResult("fluency", null, 0)]);
    expect(state.currentDifficulty).toBe("B2");
  });
});

describe("selectNextStep — targeting missing evidence", () => {
  it("targets the competency with the lowest coverage next", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [
      evidenceResult("fluency", "B2", 0.8),
      evidenceResult("fluency", "B2", 0.8),
      evidenceResult("fluency", "B2", 0.8),
    ]);

    const step = selectNextStep(state);
    expect(step.kind).toBe("anchor");
    if (step.kind === "anchor") {
      expect(step.task.competencies).toContain("lexicalResource");
    }
  });
});

describe("selectNextStep — follow-up policy", () => {
  it("offers only allowed intents for the in-progress task", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = beginTaskRun(state, TEST_TASKS[0]);

    const step = selectNextStep(state);
    expect(step.kind).toBe("follow_up");
    if (step.kind === "follow_up") {
      expect(step.task.id).toBe("task-a");
      expect(["clarify", "reformulate"]).toContain(step.intent);
    }
  });

  it("stops offering follow-ups for a task once followUpPolicy.max is reached", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = beginTaskRun(state, TEST_TASKS[0]); // max: 2
    state = recordFollowUp(state, "clarify");
    state = recordFollowUp(state, "reformulate");

    const step = selectNextStep(state);
    if (step.kind === "follow_up") {
      expect(step.task.id).not.toBe("task-a");
    }
  });
});

describe("selectNextStep — stopping", () => {
  it("stops once every required competency reaches target coverage and confidence", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    for (const competency of [
      "fluency",
      "lexicalResource",
      "interactiveCommunication",
    ] as const) {
      state = applyEvidence(state, [
        evidenceResult(competency, "B2", 0.9),
        evidenceResult(competency, "B2", 0.9),
        evidenceResult(competency, "B2", 0.9),
      ]);
    }

    const step = selectNextStep(state);
    expect(step).toEqual({ kind: "stop", reason: "sufficient_coverage_and_confidence" });
  });

  it("stops via the hard turn ceiling even when coverage never completes", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = { ...state, turnsTaken: MAX_TURNS };

    const step = selectNextStep(state);
    expect(step).toEqual({ kind: "stop", reason: "max_turns_reached" });
  });

  it("completes the in-progress task run when stopping", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = beginTaskRun(state, TEST_TASKS[0]);
    state = { ...state, turnsTaken: MAX_TURNS };

    const step = selectNextStep(state);
    expect(step.kind).toBe("stop");
    // selectNextStep itself must not mutate task run status — only the
    // orchestration hook applies `stop()`. Confirm the helper does so
    // correctly:
    const stopped = completeCurrentTaskRun(state);
    expect(stopped.taskRuns[0].status).toBe("completed");
  });
});

describe("applyEvidence", () => {
  it("never fabricates confidence for a competency with zero samples", () => {
    const state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    expect(state.evidenceByCompetency.listening.sampleCount).toBe(0);
    expect(state.evidenceByCompetency.listening.confidence).toBe(0);
    expect(state.evidenceByCompetency.listening.coverage).toBe(0);
  });

  it("increases sampleCount and coverage for insufficientEvidence results without adding a level vote", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [evidenceResult("fluency", null, 0)]);

    const fluency = state.evidenceByCompetency.fluency;
    expect(fluency.sampleCount).toBe(1);
    expect(fluency.coverage).toBeGreaterThan(0);
    expect(fluency.confidence).toBe(0);
    expect(Object.keys(fluency.levelCandidates)).toHaveLength(0);
  });
});
