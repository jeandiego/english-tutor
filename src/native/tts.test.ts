import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsSetup } from "../types/tts";
import { loadTtsSetup, saveTtsSettings, TtsError } from "./tts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const setup: TtsSetup = {
  settings: {
    provider: "macos_say",
    voiceId: "Daniel",
    rate: 200,
    kokoroExecutablePath: "",
    kokoroModelPath: "",
    kokoroVoicesPath: "",
  },
  providers: [
    {
      id: "macos_say",
      label: "macOS Speech",
      availability: { available: true, message: "macOS speech is ready." },
      voices: [{ id: "Daniel", label: "Daniel", locale: "en_GB" }],
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("native tts service", () => {
  it("loads and saves tts settings through typed commands", async () => {
    invokeMock.mockResolvedValue(setup);

    await expect(loadTtsSetup()).resolves.toBe(setup);
    await expect(saveTtsSettings(setup.settings)).resolves.toBe(setup);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_tts_setup");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_tts_settings", {
      settings: setup.settings,
    });
  });

  it("maps structured native failures to TtsError", async () => {
    invokeMock.mockRejectedValue({
      code: "configuration-write-failed",
      message: "The voice settings could not be saved.",
      technicalMessage: "permission denied",
    });

    await expect(saveTtsSettings(setup.settings)).rejects.toEqual(
      expect.objectContaining<Partial<TtsError>>({
        code: "configuration-write-failed",
        message: "The voice settings could not be saved.",
        technicalMessage: "permission denied",
      }),
    );
  });
});
