export type TtsProviderId = "macos_say" | "kokoro_local" | "elevenlabs";

export const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
  macos_say: "macOS Speech",
  kokoro_local: "Kokoro (local)",
  elevenlabs: "ElevenLabs",
};

export type AccentRegion = "american" | "british" | "irish" | "australian";

export type VoiceGender = "female" | "male";

export type TtsVoice = {
  id: string;
  label: string;
  locale?: string;
  previewUrl?: string;
  accentRegion?: AccentRegion;
  gender?: VoiceGender;
  naturalness?: number;
};

export type TtsAvailability = {
  available: boolean;
  message: string;
  technicalMessage?: string;
};

export type TtsProviderInfo = {
  id: TtsProviderId;
  label: string;
  availability: TtsAvailability;
  voices: TtsVoice[];
  supportsRate: boolean;
  supportsVolume: boolean;
};

export type TtsSettings = {
  provider: TtsProviderId;
  voiceId: string;
  rate?: number;
  volume?: number;
  kokoroExecutablePath: string;
  kokoroModelPath: string;
  kokoroVoicesPath: string;
};

export type TtsSetup = {
  settings: TtsSettings;
  providers: TtsProviderInfo[];
};

export type TtsSetupState =
  | { status: "checking" }
  | {
      status: "loaded";
      setup: TtsSetup;
      saving: boolean;
      saveError?: string;
    }
  | { status: "error"; message: string };
