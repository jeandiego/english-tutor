import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type { LexicalChunk } from "../types/chunk";
import type {
  AcceptReadingChunksRequest,
  ReadingComprehensionResult,
  ReadingEvaluationResult,
  ReadingSessionAttempt,
  ReadingTargetChunk,
  ReadingText,
  StartReadingSessionRequest,
  SubmitReadingComprehensionAnswerRequest,
  SubmitReadingProductionRequest,
} from "../types/reading";
import { useReadingToWritingSession } from "./useReadingToWritingSession";

type StartReadingSessionFn = (request: StartReadingSessionRequest) => Promise<ReadingSessionAttempt>;
type SubmitComprehensionFn = (
  request: SubmitReadingComprehensionAnswerRequest,
) => Promise<ReadingComprehensionResult>;
type AcceptChunksFn = (request: AcceptReadingChunksRequest) => Promise<LexicalChunk[]>;
type SubmitProductionFn = (request: SubmitReadingProductionRequest) => Promise<ReadingEvaluationResult>;

const TEXT: ReadingText = {
  id: "professional-email-project-delay",
  title: "A Schedule Update",
  level: "B2",
  theme: "Workplace communication",
  textType: "professional_email",
  body: "Hi Priya, the launch is delayed.",
  targetChunks: [
    { text: "give you an update", meaning: "inform someone of progress", register: "professional", chunkType: "phrase" },
    { text: "ran into an issue", meaning: "encountered a problem", register: "professional", chunkType: "phrase" },
    { text: "keep things moving", meaning: "maintain progress", register: "professional", chunkType: "phrase" },
    { text: "talk through alternatives", meaning: "discuss other options", register: "professional", chunkType: "collocation" },
  ],
  comprehensionCheck: {
    question: "Why is the launch delayed?",
    options: ["Budget", "Authentication issue", "Staffing"],
    correctOptionIndex: 1,
  },
  summaryPrompt: "Summarize in 80-120 words.",
  responsePrompt: "Write a short reply.",
};

function chunkFromTarget(id: number, target: ReadingTargetChunk): LexicalChunk {
  return {
    id,
    chunkType: target.chunkType,
    text: target.text,
    meaning: target.meaning,
    register: target.register,
    targetLevel: "B2",
    examples: [],
    origin: "reading_session",
    productiveStatus: "not_tried",
    isPromoted: false,
    createdAt: 1000,
  };
}

const EVALUATION: ReadingEvaluationResult = {
  id: 1,
  summaryFidelity: "faithful",
  responseRelevance: "relevant",
  priorityIssues: [
    { category: "summary", original: "the app got slower", suggested: "cold-start time improved", explanation: "reversed direction" },
  ],
  usefulChunks: [{ chunk: "keep things moving", register: "professional", example: "..." }],
};

function ReadingSessionHarness({
  startReadingSession = vi
    .fn<StartReadingSessionFn>()
    .mockResolvedValue({ id: 10, textId: TEXT.id, status: "reading", createdAt: 1000 }),
  submitReadingComprehensionAnswer = vi
    .fn<SubmitComprehensionFn>()
    .mockResolvedValue({ isCorrect: true }),
  acceptReadingChunks = vi
    .fn<AcceptChunksFn>()
    .mockImplementation(async (request) =>
      request.chunks.map((chunk, index) => chunkFromTarget(index + 1, chunk)),
    ),
  submitReadingProduction = vi.fn<SubmitProductionFn>().mockResolvedValue(EVALUATION),
}: {
  startReadingSession?: StartReadingSessionFn;
  submitReadingComprehensionAnswer?: SubmitComprehensionFn;
  acceptReadingChunks?: AcceptChunksFn;
  submitReadingProduction?: SubmitProductionFn;
}) {
  const session = useReadingToWritingSession({
    startReadingSession,
    submitReadingComprehensionAnswer,
    acceptReadingChunks,
    submitReadingProduction,
  });

  return (
    <>
      <p data-testid="status">{session.status}</p>
      {session.error && <p data-testid="error">{session.error.message}</p>}
      {session.evaluation && <p data-testid="evaluation-id">{session.evaluation.id}</p>}
      <p data-testid="selected-count">{session.selectedChunks.length}</p>
      <button onClick={() => void session.selectText(TEXT)} type="button">
        Select text
      </button>
      <button onClick={() => void session.submitComprehensionAnswer(1)} type="button">
        Answer
      </button>
      <button onClick={() => void session.confirmChunks(TEXT.targetChunks.slice(0, 2))} type="button">
        Confirm too few
      </button>
      <button onClick={() => void session.confirmChunks(TEXT.targetChunks)} type="button">
        Confirm valid
      </button>
      <button
        onClick={() => void session.submitProduction("A short summary.", "A short response.")}
        type="button"
      >
        Submit production
      </button>
      <button onClick={session.reset} type="button">
        Reset
      </button>
    </>
  );
}

afterEach(cleanup);

describe("useReadingToWritingSession", () => {
  it("walks the full state machine from catalog through feedback", async () => {
    render(<ReadingSessionHarness />);

    expect(screen.getByTestId("status")).toHaveTextContent("catalog");

    fireEvent.click(screen.getByRole("button", { name: "Select text" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("reading"));

    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("chunkSelection"));

    fireEvent.click(screen.getByRole("button", { name: "Confirm valid" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("production"));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("4");

    fireEvent.click(screen.getByRole("button", { name: "Submit production" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("feedback"));
    expect(screen.getByTestId("evaluation-id")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("status")).toHaveTextContent("catalog");
  });

  it("rejects a chunk selection outside the 3-5 range without calling the backend", async () => {
    const acceptReadingChunks = vi
      .fn<AcceptChunksFn>()
      .mockImplementation(async (request) =>
        request.chunks.map((chunk, index) => chunkFromTarget(index + 1, chunk)),
      );

    render(<ReadingSessionHarness acceptReadingChunks={acceptReadingChunks} />);

    fireEvent.click(screen.getByRole("button", { name: "Select text" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("reading"));
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("chunkSelection"));

    fireEvent.click(screen.getByRole("button", { name: "Confirm too few" }));

    expect(acceptReadingChunks).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("chunkSelection");
  });

  it("surfaces an error and stops at the error status when starting a session fails", async () => {
    const startReadingSession = vi
      .fn<StartReadingSessionFn>()
      .mockRejectedValue({ code: "reading-task-failed", message: "The reading session could not start." });

    render(<ReadingSessionHarness startReadingSession={startReadingSession} />);

    fireEvent.click(screen.getByRole("button", { name: "Select text" }));

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("The reading session could not start."),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("error");
  });
});
