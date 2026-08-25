import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getRuntimeHealth } from "./native/health";
import {
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  startSession,
} from "./native/history";
import {
  loadTranscriptionSetup,
  saveTranscriptionSettings,
} from "./native/transcription";
import type { TranscriptionSetup } from "./types/transcription";
import {
  loadTutorSetup,
  saveTutorSettings,
} from "./native/tutor";
import type { TutorSetup } from "./types/tutor";
import { loadTtsSetup } from "./native/tts";
import type { TtsSetup } from "./types/tts";

vi.mock("./native/health", () => ({
  getRuntimeHealth: vi.fn(),
}));

vi.mock("./native/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native/history")>();
  return {
    ...actual,
    startSession: vi.fn(),
    listRecentSessions: vi.fn(),
    listCorrectionCategoryCounts: vi.fn(),
    listRecentExpressions: vi.fn(),
  };
});

vi.mock("./native/transcription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native/transcription")>();
  return {
    ...actual,
    loadTranscriptionSetup: vi.fn(),
    saveTranscriptionSettings: vi.fn(),
    transcribeRecording: vi.fn(),
  };
});

vi.mock("./native/tutor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native/tutor")>();
  return {
    ...actual,
    loadTutorSetup: vi.fn(),
    saveTutorSettings: vi.fn(),
    requestTutorTurn: vi.fn(),
  };
});

vi.mock("./native/tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native/tts")>();
  return {
    ...actual,
    loadTtsSetup: vi.fn(),
    saveTtsSettings: vi.fn(),
  };
});

const getRuntimeHealthMock = vi.mocked(getRuntimeHealth);
const loadTranscriptionSetupMock = vi.mocked(loadTranscriptionSetup);
const saveTranscriptionSettingsMock = vi.mocked(saveTranscriptionSettings);
const loadTutorSetupMock = vi.mocked(loadTutorSetup);
const saveTutorSettingsMock = vi.mocked(saveTutorSettings);
const loadTtsSetupMock = vi.mocked(loadTtsSetup);
const startSessionMock = vi.mocked(startSession);
const listRecentSessionsMock = vi.mocked(listRecentSessions);
const listCorrectionCategoryCountsMock = vi.mocked(listCorrectionCategoryCounts);
const listRecentExpressionsMock = vi.mocked(listRecentExpressions);

const readySetup: TranscriptionSetup = {
  settings: {
    whisperExecutablePath: "/usr/local/bin/whisper-cli",
    whisperModelPath: "/models/ggml-base.en.bin",
    ffmpegExecutablePath: "ffmpeg",
  },
  preflight: {
    status: "ready",
    checks: [
      {
        dependency: "whisperExecutable",
        status: "ready",
        message: "Whisper executable path is available.",
      },
      {
        dependency: "whisperModel",
        status: "ready",
        message: "Whisper model is available.",
      },
      {
        dependency: "ffmpegExecutable",
        status: "ready",
        message: "FFmpeg executable path is available.",
      },
    ],
  },
};

const incompleteSetup: TranscriptionSetup = {
  settings: {
    whisperExecutablePath: "",
    whisperModelPath: "",
    ffmpegExecutablePath: "ffmpeg",
  },
  preflight: {
    status: "error",
    checks: [
      {
        dependency: "whisperExecutable",
        status: "notConfigured",
        message: "Set the Whisper executable path.",
      },
      {
        dependency: "whisperModel",
        status: "notConfigured",
        message: "Set the Whisper model path.",
      },
      {
        dependency: "ffmpegExecutable",
        status: "ready",
        message: "FFmpeg executable path is available.",
      },
    ],
  },
};

const readyTutorSetup: TutorSetup = {
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

const unavailableTutorSetup: TutorSetup = {
  settings: {
    baseUrl: "http://127.0.0.1:11434",
    modelName: "",
  },
  preflight: {
    status: "ollamaUnavailable",
    message: "Ollama is unavailable at http://127.0.0.1:11434.",
    technicalMessage: "connection refused",
    availableModels: [],
  },
};

const readyTtsSetup: TtsSetup = {
  settings: {
    provider: "macos_say",
    voiceId: "",
  },
  providers: [
    {
      id: "macos_say",
      label: "macOS Speech",
      availability: { available: true, message: "macOS speech is ready." },
      voices: [{ id: "Alex", label: "Alex", locale: "en_US" }],
      supportsRate: true,
      supportsVolume: true,
    },
    {
      id: "kokoro_local",
      label: "Kokoro (local)",
      availability: {
        available: false,
        message: "Set ENGLISHER_KOKORO_BINARY to a local Kokoro binary to enable it.",
      },
      voices: [],
      supportsRate: false,
      supportsVolume: true,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      availability: {
        available: false,
        message: "Set ENGLISHER_ELEVENLABS_API_KEY to enable ElevenLabs.",
      },
      voices: [],
      supportsRate: false,
      supportsVolume: true,
    },
  ],
};

function readyHealth() {
  return {
    appStatus: "ready" as const,
    operatingSystem: "macos",
    architecture: "aarch64",
  };
}

beforeEach(() => {
  loadTutorSetupMock.mockResolvedValue(readyTutorSetup);
  loadTtsSetupMock.mockResolvedValue(readyTtsSetup);
  startSessionMock.mockResolvedValue({ sessionId: 1 });
  listRecentSessionsMock.mockResolvedValue([]);
  listCorrectionCategoryCountsMock.mockResolvedValue([]);
  listRecentExpressionsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("English Coach shell", () => {
  it("keeps voice input disabled while native checks are pending", () => {
    getRuntimeHealthMock.mockReturnValue(new Promise(() => undefined));
    loadTranscriptionSetupMock.mockReturnValue(new Promise(() => undefined));

    render(<App />);

    expect(screen.getByText("Checking desktop runtime")).toBeInTheDocument();
    expect(screen.getByText("Checking local transcription")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();
  });

  it("enables voice input only when desktop, transcription, and tutor runtimes are ready", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);

    render(<App />);

    expect(await screen.findByText("Desktop runtime ready")).toBeInTheDocument();
    expect(await screen.findByText("Local transcription ready")).toBeInTheDocument();
    expect(await screen.findByText("Local tutor ready")).toBeInTheDocument();
    expect(screen.getByText("macos · aarch64")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("keeps setup details off the conversation page and opens Settings", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(incompleteSetup);

    render(<App />);

    expect(
      await screen.findByText("Local transcription needs setup"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Set the Whisper executable path."),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Whisper executable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Open transcription settings" }),
    );

    expect(await screen.findByRole("heading", { name: "Local runtimes" })).toBeInTheDocument();
    expect(screen.getByText("Set the Whisper executable path.")).toBeInTheDocument();
    expect(screen.getByText("Set the Whisper model path.")).toBeInTheDocument();
    expect(screen.getByLabelText("Whisper executable")).toBeInTheDocument();
    expect(screen.getByLabelText("Whisper model")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hold to talk/i })).not.toBeInTheDocument();
  });

  it("retries a failed settings load from the Settings page", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock
      .mockRejectedValueOnce(new Error("native bridge unavailable"))
      .mockResolvedValueOnce(incompleteSetup);

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open transcription settings" }),
    );
    expect(
      await screen.findByText("Transcription settings could not be loaded."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(loadTranscriptionSetupMock).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByLabelText("Whisper executable"),
    ).toBeInTheDocument();
  });

  it("preserves unsaved settings when navigating between pages", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(incompleteSetup);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /settings, needs attention/i }),
    );
    fireEvent.change(await screen.findByLabelText("Whisper executable"), {
      target: { value: "/custom/whisper-cli" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    fireEvent.click(
      screen.getByRole("button", { name: /settings, needs attention/i }),
    );

    expect(screen.getByLabelText("Whisper executable")).toHaveValue(
      "/custom/whisper-cli",
    );
  });

  it("saves edited paths, rechecks setup, and enables recording", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(incompleteSetup);
    saveTranscriptionSettingsMock.mockResolvedValue(readySetup);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /settings, needs attention/i }),
    );
    const whisperInput = await screen.findByLabelText("Whisper executable");
    fireEvent.change(whisperInput, {
      target: { value: "/usr/local/bin/whisper-cli" },
    });
    fireEvent.change(screen.getByLabelText("Whisper model"), {
      target: { value: "/models/ggml-base.en.bin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and verify" }));

    await waitFor(() =>
      expect(saveTranscriptionSettingsMock).toHaveBeenCalledWith({
        whisperExecutablePath: "/usr/local/bin/whisper-cli",
        whisperModelPath: "/models/ggml-base.en.bin",
        ffmpegExecutablePath: "ffmpeg",
      }),
    );
    const settingsPage = document.querySelector(".settings-page") as HTMLElement;
    expect(await within(settingsPage).findByText("Ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeEnabled();
  });

  it("locks path inputs while settings are being verified", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(incompleteSetup);
    saveTranscriptionSettingsMock.mockReturnValue(new Promise(() => undefined));

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /settings, needs attention/i }),
    );
    fireEvent.change(await screen.findByLabelText("Whisper executable"), {
      target: { value: "/custom/whisper-cli" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and verify" }));

    expect(screen.getByLabelText("Whisper executable")).toBeDisabled();
    expect(screen.getByLabelText("Whisper model")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Saving and verifying…" }),
    ).toBeDisabled();
  });

  it("surfaces the native desktop error", async () => {
    getRuntimeHealthMock.mockRejectedValue(new Error("command not found"));
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);

    render(<App />);

    expect(
      await screen.findByText("Desktop runtime unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("command not found")).toBeInTheDocument();
    expect(
      screen.getByText("Restart the desktop app and try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();
  });

  it("shows actionable Ollama setup and saves a selected local model", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);
    loadTutorSetupMock.mockResolvedValue(unavailableTutorSetup);
    saveTutorSettingsMock.mockResolvedValue(readyTutorSetup);

    render(<App />);

    expect(await screen.findByText("Ollama unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open tutor settings" }));

    expect(await screen.findByLabelText("Ollama URL")).toHaveValue(
      "http://127.0.0.1:11434",
    );
    fireEvent.change(screen.getByLabelText("Tutor model"), {
      target: { value: "qwen3.5:9b" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and verify tutor" }),
    );

    await waitFor(() =>
      expect(saveTutorSettingsMock).toHaveBeenCalledWith({
        baseUrl: "http://127.0.0.1:11434",
        modelName: "qwen3.5:9b",
      }),
    );
    const tutorSettingsPage = document.querySelector(".settings-page") as HTMLElement;
    expect(await within(tutorSettingsPage).findByText("Ready")).toBeInTheDocument();
  });

  it("opens the History tab and lists recent sessions", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);
    listRecentSessionsMock.mockResolvedValue([
      { id: 1, startedAt: 1_700_000_000_000, endedAt: 1_700_000_600_000, turnCount: 3 },
    ]);
    listCorrectionCategoryCountsMock.mockResolvedValue([
      { category: "grammar", count: 4 },
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "History" }));

    expect(await screen.findByText("3 turns")).toBeInTheDocument();
    expect(screen.getByText("Grammar")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows a non-blocking warning when the session history fails to start", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);
    startSessionMock.mockRejectedValue({
      code: "history-storage-failed",
      message: "The learning history could not be saved.",
      technicalMessage: "disk full",
    });

    render(<App />);

    expect(
      await screen.findByText("The learning history could not be saved."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeEnabled();
  });
});
