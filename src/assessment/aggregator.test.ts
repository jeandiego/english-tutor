import { describe, expect, it } from "vitest";
import type { AssessmentCompetency, CefrLevel, CompetencyEvidenceResult } from "../types/assessment";
import { aggregateResult } from "./aggregator";
import { applyEvidence, createInitialState } from "./controller";
import type { AssessmentTask } from "./types";

const TEST_TASKS: AssessmentTask[] = [
  {
    id: "task-a",
    category: "personal_narrative",
    cefrRange: { min: "B1", max: "B2" },
    competencies: ["fluency"],
    requiredFunctions: ["narrate"],
    anchorPrompt: "Tell me about your day.",
    followUpPolicy: { min: 1, max: 2, allowedIntents: ["clarify"] },
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

describe("aggregateResult", () => {
  it("reports insufficient_evidence for every competency with no samples", () => {
    const state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    const result = aggregateResult(state);

    expect(result.overallLevel).toBe("insufficient_evidence");
    expect(result.overallConfidence).toBe(0);
    const listening = result.competencyProfiles.find((p) => p.competency === "listening");
    expect(listening?.level).toBe("insufficient_evidence");
  });

  it("reports a consistent level with high confidence when evidence agrees", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [
      evidenceResult("fluency", "B2", 0.9),
      evidenceResult("fluency", "B2", 0.9),
      evidenceResult("fluency", "B2", 0.9),
    ]);

    const result = aggregateResult(state);
    const fluency = result.competencyProfiles.find((p) => p.competency === "fluency");
    expect(fluency?.level).toBe("B2");
    expect(fluency?.confidence).toBeGreaterThan(0.8);
    expect(fluency?.levelModifier).toBeUndefined();
  });

  it("adds a level modifier when a runner-up candidate carries meaningful weight", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [
      evidenceResult("fluency", "B2", 0.6),
      evidenceResult("fluency", "C1", 0.4),
    ]);

    const result = aggregateResult(state);
    const fluency = result.competencyProfiles.find((p) => p.competency === "fluency");
    expect(fluency?.level).toBe("B2");
    expect(fluency?.levelModifier).toBe("+");
  });

  it("never derives an overall level from a single competency's single response", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [evidenceResult("fluency", "C1", 0.9)]);

    const result = aggregateResult(state);
    // Only fluency has any evidence, and lexicalResource is still fully
    // uncovered — the overall estimate should reflect that thin sample,
    // not confidently declare C1 for the whole learner.
    expect(result.overallConfidence).toBeLessThan(1);
  });

  it("computes overall level as a confidence-weighted vote across competencies, not an average index", () => {
    let state = createInitialState(TEST_TASKS, "bp-1", "rb-1");
    state = applyEvidence(state, [
      evidenceResult("fluency", "A2", 0.9),
      evidenceResult("fluency", "A2", 0.9),
      evidenceResult("fluency", "A2", 0.9),
    ]);
    state = applyEvidence(state, [
      evidenceResult("lexicalResource", "C1", 0.9),
      evidenceResult("lexicalResource", "C1", 0.9),
      evidenceResult("lexicalResource", "C1", 0.9),
    ]);

    const result = aggregateResult(state);
    // A naive arithmetic mean of indices would land on B1; the vote must
    // land on one of the two actually-observed levels instead.
    expect(["A2", "C1"]).toContain(result.overallLevel);
  });
});
