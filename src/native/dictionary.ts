import { invoke } from "@tauri-apps/api/core";
import type {
  DictionaryContextTag,
  DictionaryEntry,
  ExplainSelectionRequest,
  PromoteDictionaryEntryRequest,
  SetDictionaryEntryExcludedRequest,
} from "../types/dictionary";
import type { LexicalChunk } from "../types/chunk";

export class DictionaryError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "DictionaryError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toDictionaryError(error: unknown): DictionaryError {
  if (error instanceof DictionaryError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string" ? error.message : "The dictionary could not continue.";
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    return new DictionaryError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new DictionaryError("unknown", "The dictionary could not continue.", technicalMessage);
}

export async function explainSelection(request: ExplainSelectionRequest): Promise<DictionaryEntry> {
  try {
    return await invoke<DictionaryEntry>("explain_selection", { request });
  } catch (error) {
    throw toDictionaryError(error);
  }
}

export async function listDictionaryEntries(
  contextTag?: DictionaryContextTag,
  includeExcluded?: boolean,
  limit?: number,
): Promise<DictionaryEntry[]> {
  try {
    return await invoke<DictionaryEntry[]>("list_dictionary_entries", {
      contextTag,
      includeExcluded,
      limit,
    });
  } catch (error) {
    throw toDictionaryError(error);
  }
}

export async function setDictionaryEntryExcluded(
  request: SetDictionaryEntryExcludedRequest,
): Promise<DictionaryEntry> {
  try {
    return await invoke<DictionaryEntry>("set_dictionary_entry_excluded", { request });
  } catch (error) {
    throw toDictionaryError(error);
  }
}

export async function promoteDictionaryEntry(
  request: PromoteDictionaryEntryRequest,
): Promise<LexicalChunk> {
  try {
    return await invoke<LexicalChunk>("promote_dictionary_entry", { request });
  } catch (error) {
    throw toDictionaryError(error);
  }
}
