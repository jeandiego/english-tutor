import { useCallback, useEffect, useState } from "react";
import { getRuntimeHealth } from "../native/health";
import {
  loadTranscriptionSetup,
  saveTranscriptionSettings,
  toTranscriptionError,
} from "../native/transcription";
import type { HealthState } from "../types/runtime";
import type {
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";

const DEFAULT_SETTINGS: TranscriptionSettings = {
  whisperExecutablePath: "",
  whisperModelPath: "",
  ffmpegExecutablePath: "ffmpeg",
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

export function useRuntimeSetup() {
  const [healthState, setHealthState] = useState<HealthState>({
    status: "checking",
  });
  const [transcriptionState, setTranscriptionState] =
    useState<TranscriptionSetupState>({ status: "checking" });
  const [settingsDraft, setSettingsDraft] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);

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

  const transcriptionReady =
    transcriptionState.status === "loaded" &&
    !transcriptionState.saving &&
    transcriptionState.setup.preflight.status === "ready";
  const settingsDirty =
    transcriptionState.status === "loaded" &&
    !settingsEqual(settingsDraft, transcriptionState.setup.settings);

  const resetSettingsDraft = () => {
    if (transcriptionState.status === "loaded") {
      setSettingsDraft(transcriptionState.setup.settings);
    }
  };

  return {
    healthState,
    reloadTranscriptionSetup,
    resetSettingsDraft,
    saveSettings,
    settingsDirty,
    settingsDraft,
    setSettingsDraft,
    transcriptionReady,
    transcriptionState,
  };
}
