import { invoke } from "@tauri-apps/api/core";
import type { StorageInfo } from "../types/storage";

export class StorageError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The learning history storage is unavailable.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new StorageError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new StorageError(
    "unknown",
    "The learning history storage is unavailable.",
    technicalMessage,
  );
}

export async function getStorageInfo(): Promise<StorageInfo> {
  try {
    return await invoke<StorageInfo>("get_storage_info");
  } catch (error) {
    throw toStorageError(error);
  }
}

export async function wipeDatabase(): Promise<void> {
  try {
    await invoke("wipe_database");
  } catch (error) {
    throw toStorageError(error);
  }
}

export async function exportDatabase(destination: string): Promise<void> {
  try {
    await invoke("export_database", { destination });
  } catch (error) {
    throw toStorageError(error);
  }
}

export async function importDatabase(source: string): Promise<void> {
  try {
    await invoke("import_database", { source });
  } catch (error) {
    throw toStorageError(error);
  }
}
