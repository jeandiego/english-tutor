import { useCallback, useEffect, useState } from "react";
import { getRuntimeHealth } from "../native/health";
import {
  loadTranscriptionSetup,
  saveTranscriptionSettings,
  toTranscriptionError,
} from "../native/transcription";
import {
  loadTutorSetup,
  saveTutorSettings as persistTutorSettings,
  toTutorError,
} from "../native/tutor";
import type { HealthState } from "../types/runtime";
import type {
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";
import type {
  TutorSettings,
  TutorSetupState,
} from "../types/tutor";

const DEFAULT_SETTINGS: TranscriptionSettings = {
  whisperExecutablePath: "",
  whisperModelPath: "",
  ffmpegExecutablePath: "ffmpeg",
};

const DEFAULT_TUTOR_SETTINGS: TutorSettings = {
  baseUrl: "http://127.0.0.1:11434",
  modelName: "",
};

function settingsEqual(
  left: TranscriptionSettings,
  right: TranscriptionSettings,
) {
  return (
    left.whisperExecutablePath === right.whisperExecutablePath &&
    left.whisperModelPath === right.whisperModelPath &&
    left.ffmpegExecutablePath === right.ffmpegExecutablePath
  );
}

function tutorSettingsEqual(left: TutorSettings, right: TutorSettings) {
  return left.baseUrl === right.baseUrl && left.modelName === right.modelName;
}

export function useRuntimeSetup() {
  const [healthState, setHealthState] = useState<HealthState>({
    status: "checking",
  });
  const [transcriptionState, setTranscriptionState] =
    useState<TranscriptionSetupState>({ status: "checking" });
  const [tutorState, setTutorState] = useState<TutorSetupState>({
    status: "checking",
  });
  const [settingsDraft, setSettingsDraft] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [tutorSettingsDraft, setTutorSettingsDraft] = useState<TutorSettings>(
    DEFAULT_TUTOR_SETTINGS,
  );

  useEffect(() => {
    let ignore = false;

    async function checkDesktopRuntime() {
      try {
        const health = await getRuntimeHealth();

        if (!ignore) {
          setHealthState({ status: "ready", health });
        }
      } catch (error) {
        if (!ignore) {
          setHealthState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void checkDesktopRuntime();

    return () => {
      ignore = true;
    };
  }, []);

  const reloadTutorSetup = useCallback(async () => {
    setTutorState({ status: "checking" });

    try {
      const setup = await loadTutorSetup();
      setTutorSettingsDraft(setup.settings);
      setTutorState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const tutorError = toTutorError(error);
      setTutorState({ status: "error", message: tutorError.message });
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function checkTutorRuntime() {
      try {
        const setup = await loadTutorSetup();

        if (!ignore) {
          setTutorSettingsDraft(setup.settings);
          setTutorState({ status: "loaded", setup, saving: false });
        }
      } catch (error) {
        if (!ignore) {
          const tutorError = toTutorError(error);
          setTutorState({ status: "error", message: tutorError.message });
        }
      }
    }

    void checkTutorRuntime();

    return () => {
      ignore = true;
    };
  }, []);

  const reloadTranscriptionSetup = useCallback(async () => {
    setTranscriptionState({ status: "checking" });

    try {
      const setup = await loadTranscriptionSetup();
      setSettingsDraft(setup.settings);
      setTranscriptionState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const transcriptionError = toTranscriptionError(error);
      setTranscriptionState({
        status: "error",
        message: transcriptionError.message,
      });
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function checkTranscriptionRuntime() {
      try {
        const setup = await loadTranscriptionSetup();

        if (!ignore) {
          setSettingsDraft(setup.settings);
          setTranscriptionState({ status: "loaded", setup, saving: false });
        }
      } catch (error) {
        if (!ignore) {
          const transcriptionError = toTranscriptionError(error);
          setTranscriptionState({
            status: "error",
            message: transcriptionError.message,
          });
        }
      }
    }

    void checkTranscriptionRuntime();

    return () => {
      ignore = true;
    };
  }, []);

  const saveSettings = async () => {
    if (transcriptionState.status !== "loaded") {
      return;
    }

    const previousSetup = transcriptionState.setup;
    setTranscriptionState({
      status: "loaded",
      setup: previousSetup,
      saving: true,
    });

    try {
      const setup = await saveTranscriptionSettings(settingsDraft);
      setSettingsDraft(setup.settings);
      setTranscriptionState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const transcriptionError = toTranscriptionError(error);
      setTranscriptionState({
        status: "loaded",
        setup: previousSetup,
        saving: false,
        saveError: transcriptionError.message,
      });
    }
  };

  const saveTutorSettings = async () => {
    if (tutorState.status !== "loaded") {
      return;
    }

    const previousSetup = tutorState.setup;
    setTutorState({ status: "loaded", setup: previousSetup, saving: true });

    try {
      const setup = await persistTutorSettings(tutorSettingsDraft);
      setTutorSettingsDraft(setup.settings);
      setTutorState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const tutorError = toTutorError(error);
      setTutorState({
        status: "loaded",
        setup: previousSetup,
        saving: false,
        saveError: tutorError.message,
      });
    }
  };

  const transcriptionReady =
    transcriptionState.status === "loaded" &&
    !transcriptionState.saving &&
    transcriptionState.setup.preflight.status === "ready";
  const settingsDirty =
    transcriptionState.status === "loaded" &&
    !settingsEqual(settingsDraft, transcriptionState.setup.settings);
  const tutorReady =
    tutorState.status === "loaded" &&
    !tutorState.saving &&
    tutorState.setup.preflight.status === "ready";
  const tutorSettingsDirty =
    tutorState.status === "loaded" &&
    !tutorSettingsEqual(tutorSettingsDraft, tutorState.setup.settings);

  const resetSettingsDraft = () => {
    if (transcriptionState.status === "loaded") {
      setSettingsDraft(transcriptionState.setup.settings);
    }
  };

  const resetTutorSettingsDraft = () => {
    if (tutorState.status === "loaded") {
      setTutorSettingsDraft(tutorState.setup.settings);
    }
  };

  return {
    healthState,
    reloadTranscriptionSetup,
    reloadTutorSetup,
    resetSettingsDraft,
    resetTutorSettingsDraft,
    saveSettings,
    saveTutorSettings,
    settingsDirty,
    settingsDraft,
    setSettingsDraft,
    setTutorSettingsDraft,
    transcriptionReady,
    transcriptionState,
    tutorReady,
    tutorSettingsDirty,
    tutorSettingsDraft,
    tutorState,
  };
}
