import { describe, expect, it } from "vitest";
import { relativeTimeFor } from "./relativeTime";

const NOW = new Date("2026-08-31T12:00:00Z").getTime();

describe("relativeTimeFor", () => {
  it("returns 'Just now' for timestamps under a minute old", () => {
    expect(relativeTimeFor(NOW - 30_000, NOW)).toBe("Just now");
  });

  it("returns minutes ago under an hour", () => {
    expect(relativeTimeFor(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });

  it("returns hours ago under a day", () => {
    expect(relativeTimeFor(NOW - 3 * 60 * 60_000, NOW)).toBe("3h ago");
  });

  it("returns days ago under a week", () => {
    expect(relativeTimeFor(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe("2d ago");
  });

  it("falls back to a short date at a week or older", () => {
    const result = relativeTimeFor(NOW - 8 * 24 * 60 * 60_000, NOW);
    expect(result).not.toMatch(/ago$/);
  });

  it("treats future timestamps as just now instead of going negative", () => {
    expect(relativeTimeFor(NOW + 10_000, NOW)).toBe("Just now");
  });
});
