import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TutorSetup, TutorTurn } from "../types/tutor";
import {
  loadTutorSetup,
  requestTutorTurn,
  saveTutorSettings,
  TutorError,
} from "./tutor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const setup: TutorSetup = {
  settings: {
    baseUrl: "http://127.0.0.1:11434",
    modelName: "qwen3.5:9b",
  },
  preflight: {
    status: "ready",
    message: "Ollama is ready with qwen3.5:9b.",
    version: "0.20.4",
    availableModels: [{ name: "qwen3.5:9b", parameterSize: "9B" }],
  },
};

const turn: TutorTurn = {
  reply: "Backend work can broaden your perspective. What are you learning?",
  corrections: [
    {
      original: "since many years",
      correction: "for many years",
      explanation: "Use for with a duration.",
      category: "grammar",
      severity: "important",
    },
  ],
  betterExpressions: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native tutor service", () => {
  it("loads and saves tutor settings through typed commands", async () => {
    invokeMock.mockResolvedValue(setup);

    await expect(loadTutorSetup()).resolves.toBe(setup);
    await expect(saveTutorSettings(setup.settings)).resolves.toBe(setup);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_tutor_setup");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_tutor_settings", {
      settings: setup.settings,
    });
  });

  it("sends the transcript and prior conversation without runtime settings", async () => {
    invokeMock.mockResolvedValue(turn);
    const request = {
      transcript: "Lately I am studying more backend.",
      history: [
        { role: "user" as const, content: "I work with React." },
        { role: "assistant" as const, content: "What do you enjoy about it?" },
      ],
    };

    await expect(requestTutorTurn(request)).resolves.toBe(turn);
    expect(invokeMock).toHaveBeenCalledWith("generate_tutor_turn", { request });
  });

  it("maps structured native failures to TutorError", async () => {
    invokeMock.mockRejectedValue({
      code: "invalid-response",
      message: "The local tutor returned invalid structured output.",
      technicalMessage: "missing field corrections",
    });

    await expect(
      requestTutorTurn({ transcript: "Hello", history: [] }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TutorError>>({
        code: "invalid-response",
        message: "The local tutor returned invalid structured output.",
        technicalMessage: "missing field corrections",
      }),
    );
  });
});
