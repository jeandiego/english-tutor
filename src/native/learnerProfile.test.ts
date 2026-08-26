import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LearnerProfileError,
  applyAssessmentToLearnerProfile,
  getLearnerProfile,
  saveLearnerProfilePreferences,
} from "./learnerProfile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const EMPTY_PROFILE = {
  dimensionLevels: {},
  goals: [],
  preferredScenarios: [],
  targetAccents: [],
  recurringIssues: [],
  activeVocabulary: [],
  activeGrammarTargets: [],
  activePronunciationTargets: [],
  progressNotes: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native learner profile service", () => {
  it("fetches the learner profile through the typed command", async () => {
    invokeMock.mockResolvedValue(EMPTY_PROFILE);

    await expect(getLearnerProfile()).resolves.toBe(EMPTY_PROFILE);
    expect(invokeMock).toHaveBeenCalledWith("get_learner_profile");
  });

  it("saves declared preferences with the request wrapped as `request`", async () => {
    invokeMock.mockResolvedValue(EMPTY_PROFILE);

    await saveLearnerProfilePreferences({
      goals: ["prepare for interviews"],
      preferredScenarios: [],
      targetAccents: [],
    });

    expect(invokeMock).toHaveBeenCalledWith("save_learner_profile_preferences", {
      request: {
        goals: ["prepare for interviews"],
        preferredScenarios: [],
        targetAccents: [],
      },
    });
  });

  it("applies an assessment result with the request wrapped as `request`", async () => {
    invokeMock.mockResolvedValue(EMPTY_PROFILE);

    await applyAssessmentToLearnerProfile({
      overallLevel: "B2",
      dimensionLevels: { fluency: "B2" },
      priorities: ["past tense accuracy"],
    });

    expect(invokeMock).toHaveBeenCalledWith("apply_assessment_to_learner_profile", {
      request: {
        overallLevel: "B2",
        dimensionLevels: { fluency: "B2" },
        priorities: ["past tense accuracy"],
      },
    });
  });

  it("maps structured native failures to LearnerProfileError", async () => {
    invokeMock.mockRejectedValue({
      code: "learner-profile-storage-failed",
      message: "The learner profile could not be read.",
      technicalMessage: "disk full",
    });

    await expect(getLearnerProfile()).rejects.toEqual(
      expect.objectContaining<Partial<LearnerProfileError>>({
        code: "learner-profile-storage-failed",
        message: "The learner profile could not be read.",
        technicalMessage: "disk full",
      }),
    );
  });
});
