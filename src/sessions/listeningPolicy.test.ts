import { describe, expect, it } from "vitest";
import { shouldTriggerCheck } from "./listeningPolicy";

describe("shouldTriggerCheck", () => {
  it("does not trigger before the interval is reached", () => {
    expect(shouldTriggerCheck(0)).toBe(false);
    expect(shouldTriggerCheck(1)).toBe(false);
    expect(shouldTriggerCheck(2)).toBe(false);
  });

  it("triggers on every third qualifying turn", () => {
    expect(shouldTriggerCheck(3)).toBe(true);
    expect(shouldTriggerCheck(6)).toBe(true);
    expect(shouldTriggerCheck(9)).toBe(true);
  });

  it("does not trigger on non-multiples past the first interval", () => {
    expect(shouldTriggerCheck(4)).toBe(false);
    expect(shouldTriggerCheck(5)).toBe(false);
  });
});
