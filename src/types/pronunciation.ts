export type PronunciationTargetSource = "repair_event" | "session_summary";

export type PronunciationProblemCategory =
  | "word_stress"
  | "final_consonants"
  | "vowel_contrast"
  | "connected_speech"
  | "rhythm"
  | "specific_word";

export type DiffOpKind = "match" | "omitted" | "inserted" | "substituted";

export type WordDiffOp = {
  op: DiffOpKind;
  expected?: string;
  heard?: string;
};

export type PronunciationTarget = {
  id: number;
  phrase: string;
  source: PronunciationTargetSource;
  createdAt: number;
  attemptCount: number;
  lastAttemptAt?: number;
  isPromoted: boolean;
};

export type SubmitPronunciationAttemptRequest = {
  pronunciationTargetId: number;
  transcript: string;
  sessionId?: number;
};

export type PronunciationAttemptResult = {
  attemptId: number;
  isMatch: boolean;
  category?: PronunciationProblemCategory;
  diff: WordDiffOp[];
  hint: string;
  promoted: boolean;
};
