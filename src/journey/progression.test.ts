import { describe, expect, it } from "vitest";
import { computeJourneyProgression } from "./progression";

describe("computeJourneyProgression", () => {
  it("starts at tier 1 with no accessories for a brand new journey", () => {
    const result = computeJourneyProgression({ checkpointCount: 0, masteredChunkCount: 0 });
    expect(result.tier).toBe(1);
    expect(result.unlockedAccessories).toEqual([]);
  });

  it("raises the tier and unlocks accessories as checkpoint count crosses thresholds", () => {
    expect(computeJourneyProgression({ checkpointCount: 5, masteredChunkCount: 0 })).toEqual({
      tier: 2,
      unlockedAccessories: ["backpack"],
    });
    expect(computeJourneyProgression({ checkpointCount: 30, masteredChunkCount: 0 })).toEqual({
      tier: 4,
      unlockedAccessories: ["backpack", "cape", "crown"],
    });
  });

  it("unlocks CEFR level badges once the level reaches the threshold", () => {
    const belowThreshold = computeJourneyProgression({
      checkpointCount: 0,
      masteredChunkCount: 0,
      estimatedLevel: "A2",
    });
    expect(belowThreshold.unlockedAccessories).not.toContain("badge_b1");

    const atB1 = computeJourneyProgression({
      checkpointCount: 0,
      masteredChunkCount: 0,
      estimatedLevel: "B1",
    });
    expect(atB1.unlockedAccessories).toContain("badge_b1");

    const atC1 = computeJourneyProgression({
      checkpointCount: 0,
      masteredChunkCount: 0,
      estimatedLevel: "C1",
    });
    expect(atC1.unlockedAccessories).toEqual(expect.arrayContaining(["badge_b1", "badge_c1"]));
  });

  it("unlocks mastered-chunk accessories independently of checkpoint/level tiers", () => {
    const result = computeJourneyProgression({ checkpointCount: 0, masteredChunkCount: 30 });
    expect(result.unlockedAccessories).toEqual(expect.arrayContaining(["scroll", "tome"]));
  });
});
