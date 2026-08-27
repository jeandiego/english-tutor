import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../test/queryTestUtils";
import type { SessionStart } from "../types/history";
import { useSessionHistory } from "./useSessionHistory";

function Harness({ startSession }: { startSession: () => Promise<SessionStart> }) {
  const { learnerContext, sessionId, startError } = useSessionHistory({
    startSession,
  });

  return (
    <p>
      {sessionId !== undefined && <span>session:{sessionId}</span>}
      {learnerContext && <span>context:{learnerContext}</span>}
      {startError && <span>error:{startError.message}</span>}
    </p>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSessionHistory", () => {
  it("starts exactly one session and exposes its id and learner context", async () => {
    const startSession = vi.fn().mockResolvedValue({
      sessionId: 7,
      learnerContext: "Focus on articles.",
    });

    renderWithQueryClient(<Harness startSession={startSession} />);

    expect(await screen.findByText("session:7")).toBeInTheDocument();
    expect(screen.getByText("context:Focus on articles.")).toBeInTheDocument();
    expect(startSession).toHaveBeenCalledOnce();
  });

  it("surfaces a start failure without throwing", async () => {
    const startSession = vi.fn().mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history could not be saved.",
      technicalMessage: "disk full",
    });

    renderWithQueryClient(<Harness startSession={startSession} />);

    expect(
      await screen.findByText("error:The learning history could not be saved."),
    ).toBeInTheDocument();
  });

  it("does not start a second session on re-render", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 1 });

    const { rerender } = renderWithQueryClient(
      <Harness startSession={startSession} />,
    );
    await screen.findByText("session:1");

    await act(async () => {
      rerender(<Harness startSession={startSession} />);
    });

    expect(startSession).toHaveBeenCalledOnce();
  });
});
