import type { CefrLevel } from "../types/assessment";

export type JourneyProgressionInput = {
  checkpointCount: number;
  estimatedLevel?: CefrLevel;
  masteredChunkCount: number;
};

export type JourneyProgression = {
  tier: number;
  unlockedAccessories: string[];
};

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Each threshold reached bumps the tier by one — tier 1 is the baseline
// (no checkpoints yet), tier 5 is the top of the ladder for now.
const CHECKPOINT_TIER_THRESHOLDS = [0, 5, 15, 30, 50];

export function computeJourneyProgression(input: JourneyProgressionInput): JourneyProgression {
  const { checkpointCount, estimatedLevel, masteredChunkCount } = input;

  const tier = CHECKPOINT_TIER_THRESHOLDS.filter((threshold) => checkpointCount >= threshold).length;

  const unlockedAccessories: string[] = [];
  if (checkpointCount >= 5) unlockedAccessories.push("backpack");
  if (checkpointCount >= 15) unlockedAccessories.push("cape");
  if (checkpointCount >= 30) unlockedAccessories.push("crown");

  if (estimatedLevel) {
    const levelIndex = CEFR_ORDER.indexOf(estimatedLevel);
    if (levelIndex >= CEFR_ORDER.indexOf("B1")) unlockedAccessories.push("badge_b1");
    if (levelIndex >= CEFR_ORDER.indexOf("C1")) unlockedAccessories.push("badge_c1");
  }

  if (masteredChunkCount >= 10) unlockedAccessories.push("scroll");
  if (masteredChunkCount >= 30) unlockedAccessories.push("tome");

  return { tier, unlockedAccessories };
}
