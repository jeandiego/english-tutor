import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type {
  StartWritingTaskRequest,
  SubmitWritingDraftRequest,
  SubmitWritingRewriteRequest,
  WritingComparisonResult,
  WritingEvaluationResult,
  WritingTask,
  WritingTaskBlueprint,
} from "../types/writing";
import { useWritingGym } from "./useWritingGym";

type StartWritingTaskFn = (request: StartWritingTaskRequest) => Promise<WritingTask>;
type SubmitWritingDraftFn = (
  request: SubmitWritingDraftRequest,
) => Promise<WritingEvaluationResult>;
type SubmitWritingRewriteFn = (
  request: SubmitWritingRewriteRequest,
) => Promise<WritingComparisonResult>;

const BLUEPRINT: WritingTaskBlueprint = {
  taskType: "professional_email",
  label: "Professional email",
  communicativeGoal: "Request, inform, or follow up in a workplace context.",
  targetLevel: "B2",
  suggestedWordMin: 80,
  suggestedWordMax: 150,
  successCriteria: ["States the purpose clearly"],
  recommendedChunks: ["I'm writing to..."],
  rubric: "Professional register.",
};

function draftEvaluation(): WritingEvaluationResult {
  return {
    id: 1,
    stage: "draft",
    overallLevel: "B1",
    rewriteInstruction: "Focus on professional collocations.",
    dimensions: [
      { dimension: "lexicalResource", level: "B1", evidence: "Relies on simple vocabulary." },
    ],
    priorityIssues: [
      {
        category: "lexicalResource",
        original: "I have much experience",
        suggested: "I have extensive experience",
        explanation: "More natural professional collocation.",
      },
    ],
    usefulChunks: [
      {
        chunk: "I have extensive experience with...",
        register: "professional",
        example: "I have extensive experience with React.",
      },
    ],
  };
}

function comparisonResult(): WritingComparisonResult {
  return {
    draftEvaluation: draftEvaluation(),
    rewriteEvaluation: { ...draftEvaluation(), id: 2, stage: "rewrite", overallLevel: "B2" },
  };
}

function WritingGymHarness({
  startWritingTask = vi.fn<StartWritingTaskFn>().mockResolvedValue({
    id: 1,
    taskType: "professional_email",
    targetLevel: "B2",
    status: "drafting",
    createdAt: 1000,
  }),
  submitWritingDraft = vi.fn<SubmitWritingDraftFn>().mockResolvedValue(draftEvaluation()),
  submitWritingRewrite = vi.fn<SubmitWritingRewriteFn>().mockResolvedValue(comparisonResult()),
}: {
  startWritingTask?: StartWritingTaskFn;
  submitWritingDraft?: SubmitWritingDraftFn;
  submitWritingRewrite?: SubmitWritingRewriteFn;
}) {
  const gym = useWritingGym({ startWritingTask, submitWritingDraft, submitWritingRewrite });

  return (
    <>
      <p data-testid="status">{gym.status}</p>
      {gym.error && <p data-testid="error">{gym.error.message}</p>}
      {gym.draftEvaluation && (
        <p data-testid="draft-level">{gym.draftEvaluation.overallLevel}</p>
      )}
      {gym.comparison && (
        <p data-testid="rewrite-level">{gym.comparison.rewriteEvaluation.overallLevel}</p>
      )}
      <button onClick={() => void gym.selectTask(BLUEPRINT)} type="button">
        Select task
      </button>
      <button onClick={() => void gym.submitDraft("I have much experience.")} type="button">
        Submit draft
      </button>
      <button onClick={gym.startRewrite} type="button">
        Start rewrite
      </button>
      <button onClick={() => void gym.submitRewrite("I have extensive experience.")} type="button">
        Submit rewrite
      </button>
      <button onClick={gym.reset} type="button">
        Reset
      </button>
    </>
  );
}

afterEach(cleanup);

describe("useWritingGym", () => {
  it("walks the full state machine from catalog through comparison", async () => {
    render(<WritingGymHarness />);

    expect(screen.getByTestId("status")).toHaveTextContent("catalog");

    fireEvent.click(screen.getByRole("button", { name: "Select task" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("drafting"));

    fireEvent.click(screen.getByRole("button", { name: "Submit draft" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("draftFeedback"),
    );
    expect(screen.getByTestId("draft-level")).toHaveTextContent("B1");

    fireEvent.click(screen.getByRole("button", { name: "Start rewrite" }));
    expect(screen.getByTestId("status")).toHaveTextContent("rewriting");

    fireEvent.click(screen.getByRole("button", { name: "Submit rewrite" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("comparison"));
    expect(screen.getByTestId("rewrite-level")).toHaveTextContent("B2");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("status")).toHaveTextContent("catalog");
  });

  it("moves to the error state when starting a task fails, and reset recovers", async () => {
    const startWritingTask = vi
      .fn<StartWritingTaskFn>()
      .mockRejectedValue({ code: "writing-request-failed", message: "Ollama is unavailable." });

    render(<WritingGymHarness startWritingTask={startWritingTask} />);

    fireEvent.click(screen.getByRole("button", { name: "Select task" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("Ollama is unavailable.");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("status")).toHaveTextContent("catalog");
  });

  it("moves to the error state when the draft evaluation fails", async () => {
    const submitWritingDraft = vi
      .fn<SubmitWritingDraftFn>()
      .mockRejectedValue({ code: "invalid-response", message: "The evaluator returned invalid output." });

    render(<WritingGymHarness submitWritingDraft={submitWritingDraft} />);

    fireEvent.click(screen.getByRole("button", { name: "Select task" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("drafting"));

    fireEvent.click(screen.getByRole("button", { name: "Submit draft" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The evaluator returned invalid output.",
    );
  });
});
