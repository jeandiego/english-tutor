import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as learnerProfileNative from "../native/learnerProfile";
import { renderWithQueryClient } from "../test/queryTestUtils";
import { useLearnerProfile } from "./useLearnerProfile";

vi.mock("../native/learnerProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/learnerProfile")>();
  return {
    ...actual,
    getLearnerProfile: vi.fn(),
    saveLearnerProfilePreferences: vi.fn(),
  };
});

const BASE_PROFILE = {
  dimensionLevels: {},
  goals: ["prepare for interviews"],
  preferredScenarios: [],
  targetAccents: [],
  recurringIssues: [],
  activeVocabulary: [],
  activeGrammarTargets: [],
  activePronunciationTargets: [],
  progressNotes: [],
  listening: { voiceGenderPref: "any" as const, stage: 0 },
};

function Harness() {
  const { state, draft, setDraft, dirty, save, reset } = useLearnerProfile();

  if (state.status !== "loaded") {
    return <p data-testid="status">{state.status}</p>;
  }

  return (
    <div>
      <p data-testid="status">loaded</p>
      <p data-testid="dirty">{String(dirty)}</p>
      <p data-testid="goals">{draft.goals.join(",")}</p>
      {state.saveError && <p data-testid="save-error">{state.saveError}</p>}
      <button
        onClick={() => setDraft({ ...draft, goals: [...draft.goals, "new goal"] })}
        type="button"
      >
        Add goal
      </button>
      <button onClick={() => void save()} type="button">
        Save
      </button>
      <button onClick={reset} type="button">
        Reset
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.mocked(learnerProfileNative.getLearnerProfile).mockResolvedValue(BASE_PROFILE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLearnerProfile", () => {
  it("loads the profile once and seeds the preferences draft from it", async () => {
    renderWithQueryClient(<Harness />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("goals")).toHaveTextContent("prepare for interviews");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("marks the draft dirty after an edit and clean again after reset", async () => {
    renderWithQueryClient(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("saves the draft and surfaces the recomposed profile", async () => {
    vi.mocked(learnerProfileNative.saveLearnerProfilePreferences).mockResolvedValue({
      ...BASE_PROFILE,
      goals: ["prepare for interviews", "new goal"],
    });

    renderWithQueryClient(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(learnerProfileNative.saveLearnerProfilePreferences).toHaveBeenCalledWith({
      goals: ["prepare for interviews", "new goal"],
      preferredScenarios: [],
      targetAccents: [],
      accentFocus: undefined,
      voiceGenderPref: "any",
      listeningStage: 0,
    });
    await waitFor(() =>
      expect(screen.getByTestId("goals")).toHaveTextContent("prepare for interviews,new goal"),
    );
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("surfaces a save error without discarding the unsaved draft", async () => {
    vi.mocked(learnerProfileNative.saveLearnerProfilePreferences).mockRejectedValue({
      code: "learner-profile-storage-failed",
      message: "The learner profile could not be saved.",
      technicalMessage: "disk full",
    });

    renderWithQueryClient(<Harness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(
      await screen.findByText("The learner profile could not be saved."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("goals")).toHaveTextContent("prepare for interviews,new goal");
  });
});
