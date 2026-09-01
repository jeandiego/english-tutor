import { describe, expect, it } from "vitest";
import { findReadingText, loadReadingTexts, loadReadingTextsFrom } from "./loadReadingTexts";

const REQUIRED_TEXT_IDS = [
  "professional-email-project-delay",
  "technical-article-caching",
  "product-update-mobile-app",
  "workplace-scenario-remote-onboarding",
];

describe("loadReadingTexts", () => {
  it("loads all required texts from disk with no errors", () => {
    const catalog = loadReadingTexts();

    expect(catalog.errors).toEqual([]);
    expect(catalog.texts).toHaveLength(REQUIRED_TEXT_IDS.length);

    const ids = catalog.texts.map((text) => text.id).sort();
    expect(ids).toEqual([...REQUIRED_TEXT_IDS].sort());
  });

  it("gives every text 3-5 target chunks, exactly 3 comprehension options, and a valid correct index", () => {
    const catalog = loadReadingTexts();

    for (const text of catalog.texts) {
      expect(text.title.trim()).not.toBe("");
      expect(text.body.trim()).not.toBe("");
      expect(text.summaryPrompt.trim()).not.toBe("");
      expect(text.responsePrompt.trim()).not.toBe("");
      expect(text.targetChunks.length).toBeGreaterThanOrEqual(3);
      expect(text.targetChunks.length).toBeLessThanOrEqual(5);
      expect(text.comprehensionCheck.options).toHaveLength(3);
      expect(text.comprehensionCheck.correctOptionIndex).toBeGreaterThanOrEqual(0);
      expect(text.comprehensionCheck.correctOptionIndex).toBeLessThanOrEqual(2);
    }
  });

  it("finds a text by id and returns undefined otherwise", () => {
    const catalog = loadReadingTexts();

    expect(findReadingText(catalog.texts, "technical-article-caching")?.title).toBe(
      "Why Your API Responses Should Be Cacheable",
    );
    expect(findReadingText(catalog.texts, "unknown")).toBeUndefined();
    expect(findReadingText(catalog.texts, undefined)).toBeUndefined();
  });
});

describe("loadReadingTextsFrom", () => {
  const validText = {
    id: "test-text",
    title: "Test text",
    level: "B2",
    theme: "Testing",
    textType: "product_update",
    body: "A short body used only in tests.",
    targetChunks: [
      { text: "roll out", meaning: "release gradually", register: "neutral", chunkType: "collocation" },
      { text: "a quick heads-up", meaning: "a short warning", register: "conversational", chunkType: "phrase" },
      { text: "phase out", meaning: "gradually stop using", register: "neutral", chunkType: "collocation" },
    ],
    comprehensionCheck: {
      question: "What is this about?",
      options: ["A", "B", "C"],
      correctOptionIndex: 1,
    },
    summaryPrompt: "Summarize this.",
    responsePrompt: "Respond to this.",
  };

  it("reports a malformed text without throwing, and still loads the valid ones", () => {
    const modules = {
      "./texts/valid.json": { default: validText },
      "./texts/broken.json": { default: { id: "broken", title: "" } },
    };

    const catalog = loadReadingTextsFrom(modules);

    expect(catalog.texts).toHaveLength(1);
    expect(catalog.texts[0]?.id).toBe("test-text");
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.errors[0]?.file).toBe("broken.json");
    expect(catalog.errors[0]?.message.length).toBeGreaterThan(0);
  });

  it("reports a duplicate text id as an error instead of overwriting the first", () => {
    const modules = {
      "./texts/first.json": { default: validText },
      "./texts/second.json": { default: { ...validText, title: "Duplicate" } },
    };

    const catalog = loadReadingTextsFrom(modules);

    expect(catalog.texts).toHaveLength(1);
    expect(catalog.texts[0]?.title).toBe("Test text");
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.errors[0]?.message).toContain("Duplicate reading text id");
  });
});
