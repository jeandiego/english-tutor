import { invoke } from "@tauri-apps/api/core";
import type {
  CreateManualLexicalChunkRequest,
  ImportScenarioPackVocabularyRequest,
  LexicalChunk,
  PromoteLexicalChunkRequest,
  RecordLexicalChunkAttemptRequest,
} from "../types/chunk";

export class ChunkError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "ChunkError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toChunkError(error: unknown): ChunkError {
  if (error instanceof ChunkError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string" ? error.message : "The chunk bank could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    return new ChunkError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new ChunkError("unknown", "The chunk bank could not continue.", technicalMessage);
}

export async function listActiveLexicalChunks(limit?: number): Promise<LexicalChunk[]> {
  try {
    return await invoke<LexicalChunk[]>("list_active_lexical_chunks", { limit });
  } catch (error) {
    throw toChunkError(error);
  }
}

export async function createManualLexicalChunk(
  request: CreateManualLexicalChunkRequest,
): Promise<LexicalChunk> {
  try {
    return await invoke<LexicalChunk>("create_manual_lexical_chunk", { request });
  } catch (error) {
    throw toChunkError(error);
  }
}

export async function importScenarioPackVocabulary(
  request: ImportScenarioPackVocabularyRequest,
): Promise<LexicalChunk[]> {
  try {
    return await invoke<LexicalChunk[]>("import_scenario_pack_vocabulary", { request });
  } catch (error) {
    throw toChunkError(error);
  }
}

export async function promoteLexicalChunk(request: PromoteLexicalChunkRequest): Promise<LexicalChunk> {
  try {
    return await invoke<LexicalChunk>("promote_lexical_chunk", { request });
  } catch (error) {
    throw toChunkError(error);
  }
}

export async function recordLexicalChunkAttempt(
  request: RecordLexicalChunkAttemptRequest,
): Promise<LexicalChunk> {
  try {
    return await invoke<LexicalChunk>("record_lexical_chunk_attempt", { request });
  } catch (error) {
    throw toChunkError(error);
  }
}
