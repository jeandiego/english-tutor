import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HistoryError,
  completeSession,
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  startSession,
} from "./history";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native history service", () => {
  it("starts a free-form session with an empty request by default", async () => {
    const session = { sessionId: 1, learnerContext: "Focus on articles." };
    invokeMock.mockResolvedValue(session);

    await expect(startSession()).resolves.toBe(session);
    expect(invokeMock).toHaveBeenCalledWith("start_session", { request: {} });
  });

  it("starts a guided session with scenario metadata", async () => {
    const session = { sessionId: 2 };
    invokeMock.mockResolvedValue(session);

    const request = {
      scenarioId: "daily_standup",
      difficulty: "B1" as const,
      focus: "past tense",
      targetTurns: 5,
    };
    await expect(startSession(request)).resolves.toBe(session);
    expect(invokeMock).toHaveBeenCalledWith("start_session", { request });
  });

  it("completes a session through the typed command", async () => {
    invokeMock.mockResolvedValue(undefined);

    const request = { sessionId: 1, status: "completed" as const };
    await completeSession(request);
    expect(invokeMock).toHaveBeenCalledWith("complete_session", { request });
  });

  it("lists recent sessions, category counts, and expressions with a limit", async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce([]);

    await listRecentSessions(5);
    await listCorrectionCategoryCounts();
    await listRecentExpressions(5);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_recent_sessions", {
      limit: 5,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "list_correction_category_counts",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_recent_expressions", {
      limit: 5,
    });
  });

  it("maps structured native failures to HistoryError", async () => {
    invokeMock.mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history could not be saved.",
      technicalMessage: "disk full",
    });

    await expect(startSession()).rejects.toEqual(
      expect.objectContaining<Partial<HistoryError>>({
        code: "history-storage-failed",
        message: "The learning history could not be saved.",
        technicalMessage: "disk full",
      }),
    );
  });
});
