import type { TutorMessage } from "./tutor";

export type ListeningCheckType =
  | "detail_question"
  | "summary_choice"
  | "repeat_own_words"
  | "detail_followup";

export type ComprehensionCheck = {
  id: number;
  checkType: ListeningCheckType;
  question: string;
  options?: string[];
};

export type GenerateComprehensionCheckRequest = {
  sessionId?: number;
  tutorReply: string;
  recentHistory?: TutorMessage[];
  accentFocus?: ListeningAccentFocus;
  stage: number;
};

export type SubmitListeningCheckAttemptRequest = {
  checkId: number;
  answer: string;
};

export type ListeningCheckResult = {
  isCorrect: boolean;
  feedback: string;
  newStage: number;
};

export type ListeningAccentFocus =
  | "american"
  | "british"
  | "mixed"
  | "software_workplace"
  | "travel_everyday";

export type VoiceGenderPreference = "any" | "female" | "male";

export type ListeningProfile = {
  accentFocus?: ListeningAccentFocus;
  voiceGenderPref: VoiceGenderPreference;
  stage: number;
};
