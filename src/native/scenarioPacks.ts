import { invoke } from "@tauri-apps/api/core";

export class ScenarioPacksError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "ScenarioPacksError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toScenarioPacksError(error: unknown): ScenarioPacksError {
  if (error instanceof ScenarioPacksError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string" ? error.message : "The pack favorites could not be updated.";
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    return new ScenarioPacksError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new ScenarioPacksError(
    "unknown",
    "The pack favorites could not be updated.",
    technicalMessage,
  );
}

export async function listFavoritePacks(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_favorite_packs");
  } catch (error) {
    throw toScenarioPacksError(error);
  }
}

export async function setPackFavorite(packId: string, favorite: boolean): Promise<string[]> {
  try {
    return await invoke<string[]>("set_pack_favorite", { packId, favorite });
  } catch (error) {
    throw toScenarioPacksError(error);
  }
}
