import { describe, expect, it } from "vitest";
import {
  DURATION_PRESETS,
  SESSION_TEMPLATES,
  findDurationPreset,
  findSessionTemplate,
} from "./catalog";

describe("session catalog", () => {
  it("has eight unique, non-empty templates", () => {
    expect(SESSION_TEMPLATES).toHaveLength(8);
    const ids = new Set(SESSION_TEMPLATES.map((template) => template.id));
    expect(ids.size).toBe(SESSION_TEMPLATES.length);

    for (const template of SESSION_TEMPLATES) {
      expect(template.label.trim()).not.toBe("");
      expect(template.description.trim()).not.toBe("");
      expect(template.scenarioSystemPrompt.trim().length).toBeGreaterThan(20);
      expect(template.focusPlaceholder.trim()).not.toBe("");
    }
  });

  it("finds a template by id and returns undefined otherwise", () => {
    expect(findSessionTemplate("restaurant")?.label).toBe("Restaurant");
    expect(findSessionTemplate("unknown")).toBeUndefined();
    expect(findSessionTemplate(undefined)).toBeUndefined();
  });

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
