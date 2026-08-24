import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getRuntimeHealth } from "./native/health";
import {
  loadTranscriptionSetup,
  saveTranscriptionSettings,
} from "./native/transcription";
import type { TranscriptionSetup } from "./types/transcription";

vi.mock("./native/health", () => ({
  getRuntimeHealth: vi.fn(),
}));

vi.mock("./native/transcription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native/transcription")>();
  return {
    ...actual,
    loadTranscriptionSetup: vi.fn(),
    saveTranscriptionSettings: vi.fn(),
    transcribeRecording: vi.fn(),
  };
});

const getRuntimeHealthMock = vi.mocked(getRuntimeHealth);
const loadTranscriptionSetupMock = vi.mocked(loadTranscriptionSetup);
const saveTranscriptionSettingsMock = vi.mocked(saveTranscriptionSettings);

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

function readyHealth() {
  return {
    appStatus: "ready" as const,
    operatingSystem: "macos",
    architecture: "aarch64",
  };
}

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

  it("enables voice input only when desktop and transcription runtimes are ready", async () => {
    getRuntimeHealthMock.mockResolvedValue(readyHealth());
    loadTranscriptionSetupMock.mockResolvedValue(readySetup);

    render(<App />);

    expect(await screen.findByText("Desktop runtime ready")).toBeInTheDocument();
    expect(await screen.findByText("Local transcription ready")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(await screen.findByRole("heading", { name: "Local transcription" })).toBeInTheDocument();
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
      await screen.findByRole("button", { name: "Open settings" }),
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
    expect(await screen.findByText("Ready")).toBeInTheDocument();
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
});
