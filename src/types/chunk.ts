import type { CefrLevel } from "./assessment";

export type LexicalChunkType =
  | "single_word"
  | "collocation"
  | "phrase"
  | "discourse_marker"
  | "hedging_expression"
  | "stance_phrase"
  | "register_specific_expression"
  | "domain_specific_expression";

export type ChunkOrigin =
  | "correction"
  | "better_expression"
  | "repair_event"
  | "writing_task"
  | "reading_session"
  | "manual";

export type ProductiveStatus =
  | "not_tried"
  | "recognized"
  | "used_with_help"
  | "used_independently"
  | "automatic";

export type ExerciseType =
  | "use_in_sentence"
  | "complete_response"
  | "rewrite_sentence"
  | "spoken_response"
  | "mini_paragraph";

export type Modality = "written" | "spoken";

export type LexicalChunk = {
  id: number;
  chunkType: LexicalChunkType;
  text: string;
  meaning: string;
  register: string;
  targetLevel: CefrLevel;
  domain?: string;
  examples: string[];
  commonError?: string;
  origin: ChunkOrigin;
  productiveStatus: ProductiveStatus;
  isPromoted: boolean;
  lastUsedAt?: number;
  createdAt: number;
};

export type CreateManualLexicalChunkRequest = {
  text: string;
  chunkType: LexicalChunkType;
  meaning: string;
  register: string;
  targetLevel: CefrLevel;
  domain?: string;
  examples?: string[];
  commonError?: string;
};

export type PromoteLexicalChunkRequest = {
  chunkId: number;
};

export type RecordLexicalChunkAttemptRequest = {
  chunkId: number;
  exerciseType: ExerciseType;
  modality: Modality;
  prompt: string;
  transcript: string;
  outcome: "remembered" | "partially_remembered" | "missed" | "skipped";
};
