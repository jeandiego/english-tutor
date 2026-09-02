import type { LexicalChunkType } from "./chunk";

export type DictionaryContextTag = "reading" | "writing" | "conversation";

export type DictionaryEntry = {
  id: number;
  chunkType: LexicalChunkType;
  text: string;
  meaning: string;
  examples: string[];
  contextTag: DictionaryContextTag;
  sourceSessionId?: number;
  excluded: boolean;
  promotedLexicalChunkId?: number;
  createdAt: number;
  lastLookedUpAt: number;
};

export type ExplainSelectionRequest = {
  text: string;
  surroundingContext: string;
  contextTag: DictionaryContextTag;
  sessionId?: number;
};

export type SetDictionaryEntryExcludedRequest = {
  id: number;
  excluded: boolean;
};

export type PromoteDictionaryEntryRequest = {
  id: number;
};
