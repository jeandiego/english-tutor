import { describe, expect, it } from "vitest";
import { findScenarioPack, loadPacks, loadPacksFrom } from "./loadPacks";

const REQUIRED_PACK_IDS = [
  "daily-standup",
  "software-engineering-interview",
  "pair-programming",
  "restaurant",
  "shopping",
  "movies-and-series",
  "small-talk",
  "storytelling-past-experiences",
];

describe("loadPacks", () => {
  it("loads all required packs from disk with no errors", () => {
    const catalog = loadPacks();

    expect(catalog.errors).toEqual([]);
    expect(catalog.packs).toHaveLength(REQUIRED_PACK_IDS.length);

    const ids = catalog.packs.map((pack) => pack.id).sort();
    expect(ids).toEqual([...REQUIRED_PACK_IDS].sort());
  });

  it("gives every pack non-empty content in each required field", () => {
    const catalog = loadPacks();

    for (const pack of catalog.packs) {
      expect(pack.title.trim()).not.toBe("");
      expect(pack.shortDescription.trim()).not.toBe("");
      expect(pack.recommendedLevels.length).toBeGreaterThan(0);
      expect(pack.communicativeGoals.length).toBeGreaterThan(0);
      expect(pack.vocabulary.length).toBeGreaterThan(0);
      expect(pack.grammarTargets.length).toBeGreaterThan(0);
      expect(pack.conversationMoves.length).toBeGreaterThan(0);
      expect(pack.warmUpPrompts.length).toBeGreaterThan(0);
      expect(pack.rolePlayPrompts.length).toBeGreaterThan(0);
      expect(pack.challengePrompts.length).toBeGreaterThan(0);
      expect(pack.successCriteria.length).toBeGreaterThan(0);
      expect(pack.suggestedReviewItems.length).toBeGreaterThan(0);
      expect(pack.focusPlaceholder.trim()).not.toBe("");
    }
  });

  it("finds a pack by id and returns undefined otherwise", () => {
    const catalog = loadPacks();

    expect(findScenarioPack(catalog.packs, "restaurant")?.title).toBe("Restaurant");
    expect(findScenarioPack(catalog.packs, "unknown")).toBeUndefined();
    expect(findScenarioPack(catalog.packs, undefined)).toBeUndefined();
  });
});

describe("loadPacksFrom", () => {
  const validPack = {
    id: "test-pack",
    title: "Test pack",
    shortDescription: "A pack used only in tests.",
    recommendedLevels: ["B1"],
    communicativeGoals: ["Do a thing"],
    vocabulary: ["word"],
    grammarTargets: ["A grammar point"],
    conversationMoves: ["Do a move"],
    warmUpPrompts: ["A warm-up prompt"],
    rolePlayPrompts: ["A role-play prompt"],
    challengePrompts: ["A challenge prompt"],
    successCriteria: ["A success criterion"],
    suggestedReviewItems: [{ content: "something to review", type: "vocabulary" }],
    focusPlaceholder: "e.g. something",
  };

  it("reports a malformed pack without throwing, and still loads the valid ones", () => {
    const modules = {
      "./packs/valid.json": { default: validPack },
      "./packs/broken.json": { default: { id: "broken", title: "" } },
    };

    const catalog = loadPacksFrom(modules);

    expect(catalog.packs).toHaveLength(1);
    expect(catalog.packs[0]?.id).toBe("test-pack");
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.errors[0]?.file).toBe("broken.json");
    expect(catalog.errors[0]?.message.length).toBeGreaterThan(0);
  });

  it("reports a duplicate pack id as an error instead of overwriting the first", () => {
    const modules = {
      "./packs/first.json": { default: validPack },
      "./packs/second.json": { default: { ...validPack, title: "Duplicate" } },
    };

    const catalog = loadPacksFrom(modules);

    expect(catalog.packs).toHaveLength(1);
    expect(catalog.packs[0]?.title).toBe("Test pack");
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.errors[0]?.message).toContain("Duplicate pack id");
  });

  it("accepts a pack with a valid targetVocabulary field", () => {
    const modules = {
      "./packs/valid.json": {
        default: {
          ...validPack,
          targetVocabulary: [
            {
              chunkType: "phrase",
              text: "do a thing",
              meaning: "to perform an action",
              register: "neutral",
              targetLevel: "B1",
            },
          ],
        },
      },
    };

    const catalog = loadPacksFrom(modules);

    expect(catalog.errors).toEqual([]);
    expect(catalog.packs[0]?.targetVocabulary).toHaveLength(1);
    expect(catalog.packs[0]?.targetVocabulary?.[0]?.text).toBe("do a thing");
  });

  it("reports a malformed targetVocabulary entry as an error", () => {
    const modules = {
      "./packs/broken.json": {
        default: {
          ...validPack,
          targetVocabulary: [{ text: "do a thing" }],
        },
      },
    };

    const catalog = loadPacksFrom(modules);

    expect(catalog.packs).toHaveLength(0);
    expect(catalog.errors).toHaveLength(1);
  });
});
