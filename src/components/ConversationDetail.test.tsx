import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDetail } from "./ConversationDetail";
import { continueSession, getSessionDetail } from "../native/history";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type { ConversationResumeContext, SessionDetail } from "../types/history";

vi.mock("../native/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/history")>();
  return {
    ...actual,
    continueSession: vi.fn(),
    getSessionDetail: vi.fn(),
  };
});

const getSessionDetailMock = vi.mocked(getSessionDetail);
const continueSessionMock = vi.mocked(continueSession);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseDetail: SessionDetail = {
  id: 1,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  status: "completed",
  turns: [],
  reviewEvents: [],
};

describe("ConversationDetail", () => {
  it("renders the transcript in order with corrections and expressions on the right turn", async () => {
    getSessionDetailMock.mockResolvedValue({
      ...baseDetail,
      topic: "ordering food",
      turns: [
        {
          id: 1,
          role: "user",
          text: "I want a pizza",
          timestamp: 1,
          corrections: [
            {
              original: "I want a pizza",
              correction: "I'd like a pizza",
              explanation: "More polite phrasing.",
              category: "naturalness",
              severity: "minor",
            },
          ],
          expressions: [],
          repairEvents: [],
        },
        {
          id: 2,
          role: "assistant",
          text: "Sure, what size?",
          timestamp: 2,
          corrections: [],
          expressions: [
            { suggestion: "Coming right up!", explanation: "A more natural reply." },
          ],
          repairEvents: [],
        },
      ],
    });

    render(<ConversationDetail onBack={vi.fn()} sessionId={1} />);

    const userTurn = await screen.findByText("I want a pizza");
    const assistantTurn = screen.getByText("Sure, what size?");
    expect(userTurn.compareDocumentPosition(assistantTurn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText(/I'd like a pizza/)).toBeInTheDocument();
    expect(screen.getByText(/Coming right up!/)).toBeInTheDocument();
  });

  it("shows a not-found message when the session id does not exist", async () => {
    getSessionDetailMock.mockResolvedValue(null);

    render(<ConversationDetail onBack={vi.fn()} sessionId={999} />);

    expect(
      await screen.findByText("This conversation could not be found."),
    ).toBeInTheDocument();
  });

  it("renders without crashing when the session has no turns", async () => {
    getSessionDetailMock.mockResolvedValue({ ...baseDetail, turns: [] });

    render(<ConversationDetail onBack={vi.fn()} sessionId={2} />);

    expect(
      await screen.findByText("No turns were recorded for this conversation."),
    ).toBeInTheDocument();
  });

  it("shows an error message when the detail request fails", async () => {
    getSessionDetailMock.mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history is unavailable.",
    });

    render(<ConversationDetail onBack={vi.fn()} sessionId={3} />);

    expect(
      await screen.findByText("The learning history is unavailable."),
    ).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", async () => {
    const onBack = vi.fn();
    getSessionDetailMock.mockResolvedValue(baseDetail);

    render(<ConversationDetail onBack={onBack} sessionId={1} />);

    (await screen.findByText("Back to history")).click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each(["active", "abandoned", "completed"] as const)(
    "shows a Continue button for a %s conversation",
    async (status) => {
      getSessionDetailMock.mockResolvedValue({ ...baseDetail, status });

      render(<ConversationDetail onBack={vi.fn()} sessionId={1} />);

      expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
    },
  );

  it("calls onContinue with the resume payload, source title, and source startedAt after a successful continue", async () => {
    const onContinue = vi.fn();
    getSessionDetailMock.mockResolvedValue({ ...baseDetail, topic: "ordering food" });
    const resume: ConversationResumeContext = {
      sourceSessionId: 1,
      continuationSessionId: 1,
      recentMessages: [],
    };
    continueSessionMock.mockResolvedValue(resume);

    render(<ConversationDetail onBack={vi.fn()} onContinue={onContinue} sessionId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith({
        resume,
        sourceTitle: "ordering food",
        sourceStartedAt: baseDetail.startedAt,
      }),
    );
  });

  it("shows an inline error and does not call onContinue when continueSession rejects", async () => {
    const onContinue = vi.fn();
    getSessionDetailMock.mockResolvedValue(baseDetail);
    continueSessionMock.mockRejectedValue({
      code: "history-not-found",
      message: "This conversation could not be found.",
    });

    render(<ConversationDetail onBack={vi.fn()} onContinue={onContinue} sessionId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(await screen.findByText("This conversation could not be found.")).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("disables the Continue button while the mutation is pending", async () => {
    getSessionDetailMock.mockResolvedValue(baseDetail);
    let resolveContinue: ((value: ConversationResumeContext) => void) | undefined;
    continueSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveContinue = resolve;
        }),
    );

    render(<ConversationDetail onBack={vi.fn()} sessionId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: "Continuing…" })).toBeDisabled();

    resolveContinue?.({ sourceSessionId: 1, continuationSessionId: 1, recentMessages: [] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
    );
  });
});
