import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLearnerProfile, saveLearnerProfilePreferences } from "../native/learnerProfile";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import { ProgressPage } from "./ProgressPage";

vi.mock("../native/learnerProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/learnerProfile")>();
  return {
    ...actual,
    getLearnerProfile: vi.fn(),
    saveLearnerProfilePreferences: vi.fn(),
  };
});

const getLearnerProfileMock = vi.mocked(getLearnerProfile);
const saveLearnerProfilePreferencesMock = vi.mocked(saveLearnerProfilePreferences);

const BASE_PROFILE = {
  currentLevel: "B2" as const,
  dimensionLevels: { fluency: "B2" as const },
  goals: ["prepare for interviews"],
  preferredScenarios: [],
  targetAccents: [],
  recurringIssues: [{ category: "grammar", label: "grammar", count: 3 }],
  activeVocabulary: [{ suggestion: "I agree.", timestamp: 1_700_000_000_000 }],
  activeGrammarTargets: [{ category: "grammar", label: "grammar", count: 3 }],
  activePronunciationTargets: [],
  progressNotes: [
    {
      text: "Assessment completed — estimated level B2.",
      origin: "assessment" as const,
      createdAt: 1_700_000_000_000,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProgressPage", () => {
  it("shows the current level, priorities, vocabulary, goals, and notes", async () => {
    getLearnerProfileMock.mockResolvedValue(BASE_PROFILE);

    render(<ProgressPage />);

    expect((await screen.findAllByText("B2")).length).toBeGreaterThan(0);
    expect(screen.getByText("Fluency")).toBeInTheDocument();
    expect(screen.getByText("grammar")).toBeInTheDocument();
    expect(screen.getByText("I agree.")).toBeInTheDocument();
    expect(screen.getByText("prepare for interviews")).toBeInTheDocument();
    expect(
      screen.getByText("Assessment completed — estimated level B2."),
    ).toBeInTheDocument();
  });

  it("shows empty-state copy when nothing has been observed yet", async () => {
    getLearnerProfileMock.mockResolvedValue({
      dimensionLevels: {},
      goals: [],
      preferredScenarios: [],
      targetAccents: [],
      recurringIssues: [],
      activeVocabulary: [],
      activeGrammarTargets: [],
      activePronunciationTargets: [],
      progressNotes: [],
    });

    render(<ProgressPage />);

    expect(await screen.findByText("Not yet estimated")).toBeInTheDocument();
    expect(
      screen.getByText("No repeated mistakes yet — keep practicing to build this up."),
    ).toBeInTheDocument();
    expect(screen.getByText("No recent suggestions yet.")).toBeInTheDocument();
    expect(screen.getByText("No goals yet.")).toBeInTheDocument();
  });

  it("lets the user add a goal, enables Save, and persists the edited preferences", async () => {
    getLearnerProfileMock.mockResolvedValue(BASE_PROFILE);
    saveLearnerProfilePreferencesMock.mockResolvedValue({
      ...BASE_PROFILE,
      goals: ["prepare for interviews", "small talk about hobbies"],
    });

    render(<ProgressPage />);
    await screen.findByText("prepare for interviews");

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText("e.g. prepare for software engineering interviews"),
      { target: { value: "small talk about hobbies" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add goals" }));

    expect(screen.getByText("small talk about hobbies")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(saveLearnerProfilePreferencesMock).toHaveBeenCalledWith({
      goals: ["prepare for interviews", "small talk about hobbies"],
      preferredScenarios: [],
      targetAccents: [],
    });
  });

  it("removes a goal when its remove button is clicked", async () => {
    getLearnerProfileMock.mockResolvedValue(BASE_PROFILE);

    render(<ProgressPage />);
    await screen.findByText("prepare for interviews");

    fireEvent.click(screen.getByRole("button", { name: "Remove prepare for interviews" }));

    expect(screen.queryByText("prepare for interviews")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
