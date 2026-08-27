export const runtimeKeys = {
  all: ["runtime"] as const,
  health: () => [...runtimeKeys.all, "health"] as const,
  transcriptionSetup: () => [...runtimeKeys.all, "transcription", "setup"] as const,
  tutorSetup: () => [...runtimeKeys.all, "tutor", "setup"] as const,
  ttsSetup: () => [...runtimeKeys.all, "tts", "setup"] as const,
};
