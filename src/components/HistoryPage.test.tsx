import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "./HistoryPage";
import {
  continueSession,
  getSessionDetail,
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
} from "../native/history";
import { listRecentReviewEvents } from "../native/review";
import { renderWithQueryClient as render } from "../test/queryTestUtils";
import type { ConversationResumeContext, SessionDetail } from "../types/history";

vi.mock("../native/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/history")>();
  return {
    ...actual,
    continueSession: vi.fn(),
    getSessionDetail: vi.fn(),
    listRecentSessions: vi.fn(),
    listCorrectionCategoryCounts: vi.fn(),
    listRecentExpressions: vi.fn(),
  };
});

vi.mock("../native/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/review")>();
  return {
    ...actual,
    listRecentReviewEvents: vi.fn(),
  };
});

const listRecentSessionsMock = vi.mocked(listRecentSessions);
const listCorrectionCategoryCountsMock = vi.mocked(listCorrectionCategoryCounts);
const listRecentExpressionsMock = vi.mocked(listRecentExpressions);
const listRecentReviewEventsMock = vi.mocked(listRecentReviewEvents);
const getSessionDetailMock = vi.mocked(getSessionDetail);
const continueSessionMock = vi.mocked(continueSession);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HistoryPage", () => {
  it("renders recent sessions, recurring categories, and useful expressions", async () => {
    listRecentSessionsMock.mockResolvedValue([
      {
        id: 1,
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_600_000,
        turnCount: 4,
        status: "completed",
        mode: "restaurant",
        summary: {
          whatWentWell: ["Ordered confidently."],
          priorityIssues: ["past tense accuracy"],
          alternativePhrases: [],
          reviewItems: [{ content: "past tense forms", type: "grammar_pattern" }],
          repairEvents: [],
        },
      },
    ]);
    listCorrectionCategoryCountsMock.mockResolvedValue([
      { category: "grammar", count: 3 },
    ]);
    listRecentExpressionsMock.mockResolvedValue([
      { original: "I am agree", suggestion: "I agree", timestamp: 1_700_000_500_000 },
    ]);
    listRecentReviewEventsMock.mockResolvedValue([
      {
        reviewItemId: 1,
        itemType: "vocabulary",
        content: "give up",
        outcome: "remembered",
        createdAt: 1_700_000_700_000,
      },
    ]);

    render(<HistoryPage />);

    expect(await screen.findByText("4 turns")).toBeInTheDocument();
    expect(screen.getByText("Restaurant")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("Grammar")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("“I agree”")).toBeInTheDocument();

    screen.getByText("Show summary").click();
    expect(await screen.findByText("past tense accuracy")).toBeInTheDocument();
  });

  it("labels a session with no scenario as free conversation", async () => {
    listRecentSessionsMock.mockResolvedValue([
      {
        id: 2,
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_600_000,
        turnCount: 2,
        status: "active",
      },
    ]);
    listCorrectionCategoryCountsMock.mockResolvedValue([]);
    listRecentExpressionsMock.mockResolvedValue([]);
    listRecentReviewEventsMock.mockResolvedValue([]);

    render(<HistoryPage />);

    expect(await screen.findByText("Free conversation")).toBeInTheDocument();
  });

  it("shows empty-state copy when there is no history yet", async () => {
    listRecentSessionsMock.mockResolvedValue([]);
    listCorrectionCategoryCountsMock.mockResolvedValue([]);
    listRecentExpressionsMock.mockResolvedValue([]);
    listRecentReviewEventsMock.mockResolvedValue([]);

    render(<HistoryPage />);

    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
    expect(screen.getByText("No recurring patterns yet.")).toBeInTheDocument();
    expect(screen.getByText("No saved expressions yet.")).toBeInTheDocument();
    expect(screen.getByText("No review practice yet.")).toBeInTheDocument();
  });

  it("shows a message when history cannot load", async () => {
    listRecentSessionsMock.mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history is unavailable.",
    });
    listCorrectionCategoryCountsMock.mockResolvedValue([]);
    listRecentExpressionsMock.mockResolvedValue([]);
    listRecentReviewEventsMock.mockResolvedValue([]);

    render(<HistoryPage />);

    expect(
      await screen.findByText("The learning history is unavailable."),
    ).toBeInTheDocument();
  });

  it("forwards onContinue to ConversationDetail when focusSessionId is set", async () => {
    const onContinue = vi.fn();
    const baseDetail: SessionDetail = {
      id: 5,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_600_000,
      status: "active",
      turns: [],
      reviewEvents: [],
    };
    getSessionDetailMock.mockResolvedValue(baseDetail);
    const resume: ConversationResumeContext = {
      sourceSessionId: 5,
      continuationSessionId: 5,
      recentMessages: [],
    };
    continueSessionMock.mockResolvedValue(resume);

    render(<HistoryPage focusSessionId={5} onContinue={onContinue} />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(
        expect.objectContaining({ resume, sourceStartedAt: baseDetail.startedAt }),
      ),
    );
  });
});
