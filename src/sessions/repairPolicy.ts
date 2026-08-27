import type { RepairIntensity, RepairMode, RepairPriority } from "../types/repair";

export type RepairSeverityTier = "low" | "high";

const BLOCKING_PRIORITIES: RepairPriority[] = ["pronunciation", "coherence", "pragmatics"];

/**
 * How many turns must pass after a quick/repair intervention before another
 * one is allowed. Implicit turns don't reset this — they're invisible to the
 * learner, so they must not block the next real intervention. This is the
 * hard guarantee behind never interrupting every sentence, tunable per
 * intensity but never zero.
 */
export const COOLDOWN_TURNS: Record<RepairIntensity, number> = {
  light: 3,
  balanced: 2,
  strict: 1,
};

export function severityTier(
  priority: RepairPriority,
  isRecurringThisSession: boolean,
): RepairSeverityTier {
  if (isRecurringThisSession) {
    return "high";
  }
  return BLOCKING_PRIORITIES.includes(priority) ? "high" : "low";
}

export function selectRepairMode(
  intensity: RepairIntensity,
  tier: RepairSeverityTier,
  cooldownOk: boolean,
): RepairMode {
  if (intensity === "light") {
    if (!cooldownOk) return "implicit";
    return tier === "high" ? "quick" : "implicit";
  }
  if (intensity === "balanced") {
    if (!cooldownOk) return "implicit";
    return tier === "high" ? "repair" : "quick";
  }
  // strict
  if (!cooldownOk) return "quick";
  return tier === "high" ? "repair" : "quick";
}
