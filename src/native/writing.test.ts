import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WritingError,
  getWritingTask,
  listWritingTaskTypes,
  listWritingTasks,
  startWritingTask,
  submitWritingDraft,
  submitWritingRewrite,
} from "./writing";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native writing service", () => {
  it("lists writing task types through the typed command", async () => {
    invokeMock.mockResolvedValue([]);

    await expect(listWritingTaskTypes()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_writing_task_types");
  });

  it("starts a writing task with the request wrapped as `request`", async () => {
    const task = {
      id: 1,
      taskType: "professional_email",
      targetLevel: "B2",
      status: "drafting",
      createdAt: 1000,
    };
    invokeMock.mockResolvedValue(task);

    await expect(
      startWritingTask({ taskType: "professional_email" }),
    ).resolves.toBe(task);
    expect(invokeMock).toHaveBeenCalledWith("start_writing_task", {
      request: { taskType: "professional_email" },
    });
  });

  it("submits a draft with the request wrapped as `request`", async () => {
    const evaluation = { id: 1, stage: "draft" };
    invokeMock.mockResolvedValue(evaluation);

    await submitWritingDraft({
      writingTaskId: 1,
      taskType: "professional_email",
      draftText: "I have much experience.",
    });

    expect(invokeMock).toHaveBeenCalledWith("submit_writing_draft", {
      request: {
        writingTaskId: 1,
        taskType: "professional_email",
        draftText: "I have much experience.",
      },
    });
  });

  it("submits a rewrite with the request wrapped as `request`", async () => {
    const comparison = { draftEvaluation: {}, rewriteEvaluation: {} };
    invokeMock.mockResolvedValue(comparison);

    await submitWritingRewrite({
      writingTaskId: 1,
      taskType: "professional_email",
      rewriteText: "I have extensive experience.",
    });

    expect(invokeMock).toHaveBeenCalledWith("submit_writing_rewrite", {
      request: {
        writingTaskId: 1,
        taskType: "professional_email",
        rewriteText: "I have extensive experience.",
      },
    });
  });

  it("fetches a writing task detail with a camelCase id argument", async () => {
    const detail = { id: 1, taskType: "professional_email" };
    invokeMock.mockResolvedValue(detail);

    await expect(getWritingTask(1)).resolves.toBe(detail);
    expect(invokeMock).toHaveBeenCalledWith("get_writing_task", { writingTaskId: 1 });
  });

  it("lists recent writing tasks with an optional limit", async () => {
    invokeMock.mockResolvedValue([]);

    await listWritingTasks(5);

    expect(invokeMock).toHaveBeenCalledWith("list_writing_tasks", { limit: 5 });
  });

  it("maps structured native failures to WritingError", async () => {
    invokeMock.mockRejectedValue({
      code: "empty-draft",
      message: "Write a draft before submitting it for feedback.",
      technicalMessage: "draftText was empty",
    });

    await expect(
      submitWritingDraft({ writingTaskId: 1, taskType: "summary", draftText: "" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WritingError>>({
        code: "empty-draft",
        message: "Write a draft before submitting it for feedback.",
        technicalMessage: "draftText was empty",
      }),
    );
  });
});
