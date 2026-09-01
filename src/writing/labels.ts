import type { WritingDimension } from "../types/writing";

export const DIMENSION_LABELS: Record<WritingDimension, string> = {
  taskAchievement: "Task achievement",
  coherenceCohesion: "Coherence & cohesion",
  lexicalResource: "Vocabulary",
  grammar: "Grammar",
  registerTone: "Register & tone",
};

const LEVEL_RANK: Record<string, number> = { B1: 0, B2: 1, C1: 2 };

export type LevelComparison = "improved" | "same" | "declined";

export function compareLevels(before: string, after: string): LevelComparison {
  const beforeRank = LEVEL_RANK[before] ?? 0;
  const afterRank = LEVEL_RANK[after] ?? 0;
  if (afterRank > beforeRank) {
    return "improved";
  }
  if (afterRank < beforeRank) {
    return "declined";
  }
  return "same";
}
