import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyAssessmentToLearnerProfileRequest,
  LearnerProfile,
  SaveLearnerProfilePreferencesRequest,
} from "../types/learnerProfile";
import type { ApplySessionToLearnerProfileRequest } from "../types/session";

export class LearnerProfileError extends Error {
  readonly code: string;
  readonly technicalMessage: string;

  constructor(code: string, message: string, technicalMessage = message) {
    super(message);
    this.name = "LearnerProfileError";
    this.code = code;
    this.technicalMessage = technicalMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toLearnerProfileError(error: unknown): LearnerProfileError {
  if (error instanceof LearnerProfileError) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message =
      typeof error.message === "string"
        ? error.message
        : "The learner profile could not be loaded.";
    const technicalMessage =
      typeof error.technicalMessage === "string"
        ? error.technicalMessage
        : message;
    return new LearnerProfileError(code, message, technicalMessage);
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  return new LearnerProfileError(
    "unknown",
    "The learner profile could not be loaded.",
    technicalMessage,
  );
}

export async function getLearnerProfile(): Promise<LearnerProfile> {
  try {
    return await invoke<LearnerProfile>("get_learner_profile");
  } catch (error) {
    throw toLearnerProfileError(error);
  }
}

export async function saveLearnerProfilePreferences(
  request: SaveLearnerProfilePreferencesRequest,
): Promise<LearnerProfile> {
  try {
    return await invoke<LearnerProfile>("save_learner_profile_preferences", {
      request,
    });
  } catch (error) {
    throw toLearnerProfileError(error);
  }
}

export async function applyAssessmentToLearnerProfile(
  request: ApplyAssessmentToLearnerProfileRequest,
): Promise<LearnerProfile> {
  try {
    return await invoke<LearnerProfile>("apply_assessment_to_learner_profile", {
      request,
    });
  } catch (error) {
    throw toLearnerProfileError(error);
  }
}

export async function applySessionToLearnerProfile(
  request: ApplySessionToLearnerProfileRequest,
): Promise<LearnerProfile> {
  try {
    return await invoke<LearnerProfile>("apply_session_to_learner_profile", {
      request,
    });
  } catch (error) {
    throw toLearnerProfileError(error);
  }
}
