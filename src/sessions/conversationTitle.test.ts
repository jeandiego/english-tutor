import { describe, expect, it } from "vitest";
import { conversationTitleFor } from "./conversationTitle";

describe("conversationTitleFor", () => {
  it("prefers the scenario pack title when mode matches a known pack", () => {
    const title = conversationTitleFor({
      mode: "daily-standup",
      topic: "should be ignored",
      firstUserTurn: "should be ignored",
    });
    expect(title).toBe("Daily standup");
  });

  it("falls back to topic when there is no matching pack", () => {
    const title = conversationTitleFor({
      topic: "focus on past tense",
      firstUserTurn: "should be ignored",
    });
    expect(title).toBe("focus on past tense");
  });

  it("falls back to the first user turn when there is no topic", () => {
    const title = conversationTitleFor({
      firstUserTurn: "hey, how's it going",
    });
    expect(title).toBe("hey, how's it going");
  });

  it("falls back to the first summary highlight when nothing else is present", () => {
    const title = conversationTitleFor({
      summary: {
        whatWentWell: ["Used past tense correctly"],
        priorityIssues: [],
        alternativePhrases: [],
        reviewItems: [],
        repairEvents: [],
      },
    });
    expect(title).toBe("Used past tense correctly");
  });

  it("never returns an empty title", () => {
    expect(conversationTitleFor({})).toBe("Conversation");
  });

  it("truncates long fallback text", () => {
    const longTopic = "a".repeat(120);
    const title = conversationTitleFor({ topic: longTopic });
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });
});
