import { describe, expect, it } from "vitest";
import type { ListeningProfile } from "../types/listening";
import type { TtsProviderInfo } from "../types/tts";
import { selectListeningVoice } from "./listeningVoice";

function provider(overrides: Partial<TtsProviderInfo> = {}): TtsProviderInfo {
  return {
    id: "kokoro_local",
    label: "Kokoro (local)",
    availability: { available: true, message: "ready" },
    voices: [
      { id: "af_alice", label: "Alice", accentRegion: "american", gender: "female" },
      { id: "am_adam", label: "Adam", accentRegion: "american", gender: "male" },
      { id: "bf_emma", label: "Emma", accentRegion: "british", gender: "female" },
    ],
    supportsRate: false,
    supportsVolume: true,
    ...overrides,
  };
}

function profile(overrides: Partial<ListeningProfile> = {}): ListeningProfile {
  return { voiceGenderPref: "any", stage: 0, ...overrides };
}

describe("selectListeningVoice", () => {
  it("returns undefined when the current provider has no voices", () => {
    const providers = [provider({ id: "elevenlabs", voices: [] })];
    expect(selectListeningVoice(providers, "elevenlabs", profile())).toBeUndefined();
  });

  it("filters by accent focus when a match exists", () => {
    const providers = [provider()];
    const result = selectListeningVoice(providers, "kokoro_local", profile({ accentFocus: "british" }));
    expect(result?.voiceId).toBe("bf_emma");
  });

  it("falls back to the unfiltered voice list when no accent match exists", () => {
    const providers = [provider({ voices: [{ id: "af_alice", label: "Alice", accentRegion: "american" }] })];
    const result = selectListeningVoice(providers, "kokoro_local", profile({ accentFocus: "british" }));
    expect(result?.voiceId).toBe("af_alice");
  });

  it("filters by gender preference when a match exists", () => {
    const providers = [provider()];
    const result = selectListeningVoice(providers, "kokoro_local", profile({ voiceGenderPref: "male" }));
    expect(result?.voiceId).toBe("am_adam");
  });

  it("does not set a rate when the provider does not support it", () => {
    const providers = [provider({ supportsRate: false })];
    const result = selectListeningVoice(providers, "kokoro_local", profile({ stage: 2 }));
    expect(result?.rate).toBeUndefined();
  });

  it("maps stage to a words-per-minute rate when the provider supports it", () => {
    const providers = [provider({ supportsRate: true })];
    const result = selectListeningVoice(providers, "kokoro_local", profile({ stage: 4 }));
    expect(result?.rate).toBe(195);
  });

  it("surfaces a different accent-tagged voice at stage 3 for odd variety seeds only", () => {
    const providers = [provider()];
    const stableSeed = selectListeningVoice(
      providers,
      "kokoro_local",
      profile({ accentFocus: "american", stage: 3 }),
      0,
    );
    expect(stableSeed?.voiceId).toBe("af_alice");

    const variedSeed = selectListeningVoice(
      providers,
      "kokoro_local",
      profile({ accentFocus: "american", stage: 3 }),
      1,
    );
    expect(variedSeed?.voiceId).toBe("bf_emma");
  });
});
