export type TutorSettings = {
  baseUrl: string;
  modelName: string;
};

export type TutorPreflightStatus =
  | "ollamaUnavailable"
  | "noModelConfigured"
  | "configuredModelUnavailable"
  | "ready";

export type TutorModel = {
  name: string;
  parameterSize?: string;
};

export type TutorPreflight = {
  status: TutorPreflightStatus;
  message: string;
  technicalMessage?: string;
  version?: string;
  availableModels: TutorModel[];
};

export type TutorSetup = {
  settings: TutorSettings;
  preflight: TutorPreflight;
};

export type TutorMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TutorTurnRequest = {
  transcript: string;
  history: TutorMessage[];
};

export type TutorCorrection = {
  original: string;
  correction: string;
  explanation: string;
  category: "grammar" | "vocabulary" | "naturalness" | "clarity";
  severity: "minor" | "important";
};

export type BetterExpression = {
  original?: string;
  suggestion: string;
  explanation?: string;
};

export type TutorPerformance = {
  outputTokens: number;
  tokensPerSecond: number;
};

export type TutorTurn = {
  reply: string;
  corrections: TutorCorrection[];
  betterExpressions: BetterExpression[];
  performance?: TutorPerformance;
};

export type TutorSetupState =
  | { status: "checking" }
  | {
      status: "loaded";
      setup: TutorSetup;
      saving: boolean;
      saveError?: string;
    }
  | { status: "error"; message: string };
