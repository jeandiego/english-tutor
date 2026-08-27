import { describe, expect, it } from "vitest";
import type { RepairIntensity, RepairPriority } from "../types/repair";
import { COOLDOWN_TURNS, selectRepairMode, severityTier } from "./repairPolicy";

describe("severityTier", () => {
  it("treats pronunciation, coherence, and pragmatics as high severity by default", () => {
    const blocking: RepairPriority[] = ["pronunciation", "coherence", "pragmatics"];
    for (const priority of blocking) {
      expect(severityTier(priority, false)).toBe("high");
    }
  });

  it("treats grammar, vocabulary, and fluency as low severity unless recurring", () => {
    const polish: RepairPriority[] = ["grammar", "vocabulary", "fluency"];
    for (const priority of polish) {
      expect(severityTier(priority, false)).toBe("low");
      expect(severityTier(priority, true)).toBe("high");
    }
  });
});

describe("selectRepairMode", () => {
  const intensities: RepairIntensity[] = ["light", "balanced", "strict"];

  it("never selects implicit when the cooldown has not elapsed at strict intensity", () => {
    expect(selectRepairMode("strict", "high", false)).toBe("quick");
    expect(selectRepairMode("strict", "low", false)).toBe("quick");
  });

  it("falls back to implicit off-cooldown at light and balanced intensity", () => {
    expect(selectRepairMode("light", "high", false)).toBe("implicit");
    expect(selectRepairMode("balanced", "high", false)).toBe("implicit");
  });

  it("only escalates to repair mode for high-severity issues, and never at light intensity", () => {
    expect(selectRepairMode("light", "high", true)).toBe("quick");
    expect(selectRepairMode("balanced", "high", true)).toBe("repair");
    expect(selectRepairMode("strict", "high", true)).toBe("repair");
  });

  it("uses quick mode for low-severity issues once the cooldown has elapsed", () => {
    expect(selectRepairMode("balanced", "low", true)).toBe("quick");
    expect(selectRepairMode("strict", "low", true)).toBe("quick");
  });

  it("defines a strictly widening cooldown from strict to light", () => {
    expect(COOLDOWN_TURNS.strict).toBeLessThan(COOLDOWN_TURNS.balanced);
    expect(COOLDOWN_TURNS.balanced).toBeLessThan(COOLDOWN_TURNS.light);
  });

  it("never returns repair mode when cooldownOk is false, regardless of intensity", () => {
    for (const intensity of intensities) {
      expect(selectRepairMode(intensity, "high", false)).not.toBe("repair");
    }
  });
});
