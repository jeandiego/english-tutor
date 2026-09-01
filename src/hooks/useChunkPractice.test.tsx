import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type { LexicalChunk, RecordLexicalChunkAttemptRequest } from "../types/chunk";
import type { EvaluateReviewAttemptRequest, ReviewAttemptEvaluation } from "../types/review";
import { useChunkPractice } from "./useChunkPractice";

type EvaluateReviewAttemptFn = (
  request: EvaluateReviewAttemptRequest,
) => Promise<ReviewAttemptEvaluation>;
type RecordLexicalChunkAttemptFn = (request: RecordLexicalChunkAttemptRequest) => Promise<LexicalChunk>;

const CHUNK: LexicalChunk = {
  id: 1,
  chunkType: "phrase",
  text: "raise concerns about",
  meaning: "to formally mention a worry",
  register: "neutral",
  targetLevel: "C1",
  examples: ["I'd like to raise concerns about the timeline."],
  origin: "manual",
  productiveStatus: "not_tried",
  isPromoted: false,
  createdAt: 1000,
};

function promotedChunk(status: LexicalChunk["productiveStatus"]): LexicalChunk {
  return { ...CHUNK, productiveStatus: status, lastUsedAt: 2000 };
}

function ChunkPracticeHarness({
  evaluateReviewAttempt = vi
    .fn<EvaluateReviewAttemptFn>()
    .mockResolvedValue({ outcome: "remembered" }),
  recordLexicalChunkAttempt = vi
    .fn<RecordLexicalChunkAttemptFn>()
    .mockResolvedValue(promotedChunk("recognized")),
}: {
  evaluateReviewAttempt?: EvaluateReviewAttemptFn;
  recordLexicalChunkAttempt?: RecordLexicalChunkAttemptFn;
}) {
  const practice = useChunkPractice({ evaluateReviewAttempt, recordLexicalChunkAttempt });

  return (
    <>
      <p data-testid="status">{practice.status}</p>
      {practice.error && <p data-testid="error">{practice.error.message}</p>}
      {practice.evaluation && <p data-testid="outcome">{practice.evaluation.outcome}</p>}
      {practice.updatedChunk && (
        <p data-testid="updated-status">{practice.updatedChunk.productiveStatus}</p>
      )}
      <button onClick={() => practice.start(CHUNK)} type="button">
        Start
      </button>
      <button onClick={() => void practice.submit("I raised concerns about the deadline.")} type="button">
        Submit
      </button>
      <button onClick={practice.reset} type="button">
        Reset
      </button>
    </>
  );
}

afterEach(cleanup);

describe("useChunkPractice", () => {
  it("walks the full state machine from idle through result", async () => {
    render(<ChunkPracticeHarness />);

    expect(screen.getByTestId("status")).toHaveTextContent("idle");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByTestId("status")).toHaveTextContent("answering");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("result"));
    expect(screen.getByTestId("outcome")).toHaveTextContent("remembered");
    expect(screen.getByTestId("updated-status")).toHaveTextContent("recognized");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("returns to answering with an error message when evaluation fails", async () => {
    const evaluateReviewAttempt = vi
      .fn<EvaluateReviewAttemptFn>()
      .mockRejectedValue({ code: "review-request-failed", message: "The local tutor is unavailable." });

    render(<ChunkPracticeHarness evaluateReviewAttempt={evaluateReviewAttempt} />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("The local tutor is unavailable."));
    expect(screen.getByTestId("status")).toHaveTextContent("answering");
  });

  it("passes the evaluated outcome through to the recorded attempt", async () => {
    const evaluateReviewAttempt = vi
      .fn<EvaluateReviewAttemptFn>()
      .mockResolvedValue({ outcome: "partially_remembered" });
    const recordLexicalChunkAttempt = vi
      .fn<RecordLexicalChunkAttemptFn>()
      .mockResolvedValue(promotedChunk("used_with_help"));

    render(
      <ChunkPracticeHarness
        evaluateReviewAttempt={evaluateReviewAttempt}
        recordLexicalChunkAttempt={recordLexicalChunkAttempt}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("result"));
    expect(recordLexicalChunkAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ chunkId: CHUNK.id, outcome: "partially_remembered" }),
    );
    expect(screen.getByTestId("updated-status")).toHaveTextContent("used_with_help");
  });
});
