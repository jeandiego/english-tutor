import { describe, expect, it } from "vitest";
import { DURATION_PRESETS, findDurationPreset } from "./catalog";

describe("duration presets", () => {
  it("has three unique duration presets with increasing target turns", () => {
    expect(DURATION_PRESETS).toHaveLength(3);
    const turns = DURATION_PRESETS.map((preset) => preset.targetTurns);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
  });

  it("falls back to the standard preset for an unknown id", () => {
    expect(findDurationPreset("quick").targetTurns).toBe(4);
    // @ts-expect-error deliberately invalid id to exercise the fallback branch
    expect(findDurationPreset("nonsense").id).toBe("standard");
  });
});
