export type TranscriptionSettings = {
  whisperExecutablePath: string;
  whisperModelPath: string;
  ffmpegExecutablePath: string;
};

export type TranscriptionDependency =
  | "whisperExecutable"
  | "whisperModel"
  | "ffmpegExecutable";

export type DependencyStatus =
  | "ready"
  | "notConfigured"
  | "notFound"
  | "notRunnable";

export type DependencyCheck = {
  dependency: TranscriptionDependency;
  status: DependencyStatus;
  message: string;
  technicalMessage?: string | null;
};

export type TranscriptionPreflight = {
  status: "ready" | "error";
  checks: DependencyCheck[];
};

export type TranscriptionSetup = {
  settings: TranscriptionSettings;
  preflight: TranscriptionPreflight;
};

export type TranscriptionResult = {
  text: string;
};

export type TranscriptionSetupState =
  | { status: "checking" }
  | {
      status: "loaded";
      setup: TranscriptionSetup;
      saving: boolean;
      saveError?: string;
    }
  | { status: "error"; message: string };
