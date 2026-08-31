import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "../test/queryTestUtils";
import type { ConversationResumeContext, SessionStart } from "../types/history";
import { useLiveConversation } from "./useLiveConversation";

type Live = ReturnType<typeof useLiveConversation>;

function Harness({
  capture,
  startSession,
}: {
  capture: (live: Live) => void;
  startSession: () => Promise<SessionStart>;
}) {
  const live = useLiveConversation({ startSession });
  capture(live);

  return (
    <p>
      {live.sessionId !== undefined && <span>session:{live.sessionId}</span>}
      {live.learnerContext && <span>context:{live.learnerContext}</span>}
      {live.startError && <span>error:{live.startError.message}</span>}
      {live.resumeBanner && (
        <span>banner:{live.resumeBanner.title}:{live.resumeBanner.startedAt}</span>
      )}
      {live.pendingResume && <span>pending:{live.pendingResume.sourceTitle}</span>}
    </p>
  );
}

function resumeContext(
  overrides: Partial<ConversationResumeContext> = {},
): ConversationResumeContext {
  return {
    sourceSessionId: 5,
    continuationSessionId: 5,
    recentMessages: [{ role: "user", content: "Hi" }],
    learnerContext: "Continued context.",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLiveConversation", () => {
  it("starts exactly one session and exposes its id and learner context", async () => {
    const startSession = vi.fn().mockResolvedValue({
      sessionId: 7,
      learnerContext: "Focus on articles.",
    });
    let live!: Live;

    renderWithQueryClient(
      <Harness capture={(value) => (live = value)} startSession={startSession} />,
    );

    expect(await screen.findByText("session:7")).toBeInTheDocument();
    expect(screen.getByText("context:Focus on articles.")).toBeInTheDocument();
    expect(startSession).toHaveBeenCalledOnce();
    expect(live.sessionId).toBe(7);
  });

  it("surfaces a start failure without throwing", async () => {
    const startSession = vi.fn().mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history could not be saved.",
      technicalMessage: "disk full",
    });

    renderWithQueryClient(
      <Harness capture={() => {}} startSession={startSession} />,
    );

    expect(
      await screen.findByText("error:The learning history could not be saved."),
    ).toBeInTheDocument();
  });

  it("does not start a second session on re-render", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 1 });

    const { rerender } = renderWithQueryClient(
      <Harness capture={() => {}} startSession={startSession} />,
    );
    await screen.findByText("session:1");

    await act(async () => {
      rerender(<Harness capture={() => {}} startSession={startSession} />);
    });

    expect(startSession).toHaveBeenCalledOnce();
  });

  it("requestSwitch applies immediately when there is no live activity", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 1 });
    let live!: Live;

    renderWithQueryClient(
      <Harness capture={(value) => (live = value)} startSession={startSession} />,
    );
    await screen.findByText("session:1");

    const resume = resumeContext({ continuationSessionId: 2, sourceSessionId: 2 });
    let result: "switched" | "confirm-required" | undefined;
    act(() => {
      result = live.requestSwitch(resume, "Old conversation", 111, false);
    });

    expect(result).toBe("switched");
    expect(await screen.findByText("session:2")).toBeInTheDocument();
    expect(screen.getByText("banner:Old conversation:111")).toBeInTheDocument();
    expect(screen.queryByText(/^pending:/)).not.toBeInTheDocument();
  });

  it("requestSwitch requires confirmation when there is live activity and the target is a different session", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 1 });
    let live!: Live;

    renderWithQueryClient(
      <Harness capture={(value) => (live = value)} startSession={startSession} />,
    );
    await screen.findByText("session:1");

    const resume = resumeContext({ continuationSessionId: 2, sourceSessionId: 2 });
    let result: "switched" | "confirm-required" | undefined;
    act(() => {
      result = live.requestSwitch(resume, "Old conversation", 111, true);
    });

    expect(result).toBe("confirm-required");
    expect(await screen.findByText("pending:Old conversation")).toBeInTheDocument();
    expect(screen.getByText("session:1")).toBeInTheDocument();
    expect(screen.queryByText(/^banner:/)).not.toBeInTheDocument();
  });

  it("requestSwitch applies silently even with live activity when the target is already the live session", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 5 });
    let live!: Live;

    renderWithQueryClient(
      <Harness capture={(value) => (live = value)} startSession={startSession} />,
    );
    await screen.findByText("session:5");

    const resume = resumeContext({ continuationSessionId: 5, sourceSessionId: 5 });
    let result: "switched" | "confirm-required" | undefined;
    act(() => {
      result = live.requestSwitch(resume, "Same conversation", 222, true);
    });

    expect(result).toBe("switched");
    expect(await screen.findByText("banner:Same conversation:222")).toBeInTheDocument();
    expect(screen.queryByText(/^pending:/)).not.toBeInTheDocument();
  });

  it("cancelPendingSwitch discards the pending resume without changing identity", async () => {
    const startSession = vi.fn().mockResolvedValue({ sessionId: 1 });
    let live!: Live;

    renderWithQueryClient(
      <Harness capture={(value) => (live = value)} startSession={startSession} />,
    );
    await screen.findByText("session:1");

    const resume = resumeContext({ continuationSessionId: 2, sourceSessionId: 2 });
    act(() => {
      live.requestSwitch(resume, "Old conversation", 111, true);
    });
    expect(await screen.findByText("pending:Old conversation")).toBeInTheDocument();

    act(() => {
      live.cancelPendingSwitch();
    });

    expect(screen.queryByText(/^pending:/)).not.toBeInTheDocument();
    expect(screen.getByText("session:1")).toBeInTheDocument();
    expect(screen.queryByText(/^banner:/)).not.toBeInTheDocument();
  });
});
