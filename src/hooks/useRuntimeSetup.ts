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
import {
  loadTtsSetup,
  saveTtsSettings as persistTtsSettings,
  toTtsError,
} from "../native/tts";
import type { HealthState } from "../types/runtime";
import type {
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";
import type { TtsSettings, TtsSetupState } from "../types/tts";
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
  thinkingEnabled: false,
};

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: "macos_say",
  voiceId: "",
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
  return (
    left.baseUrl === right.baseUrl &&
    left.modelName === right.modelName &&
    left.thinkingEnabled === right.thinkingEnabled
  );
}

function ttsSettingsEqual(left: TtsSettings, right: TtsSettings) {
  return (
    left.provider === right.provider &&
    left.voiceId === right.voiceId &&
    left.rate === right.rate &&
    left.volume === right.volume
  );
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
  const [ttsState, setTtsState] = useState<TtsSetupState>({
    status: "checking",
  });
  const [settingsDraft, setSettingsDraft] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [tutorSettingsDraft, setTutorSettingsDraft] = useState<TutorSettings>(
    DEFAULT_TUTOR_SETTINGS,
  );
  const [ttsSettingsDraft, setTtsSettingsDraft] = useState<TtsSettings>(
    DEFAULT_TTS_SETTINGS,
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

  const reloadTtsSetup = useCallback(async () => {
    setTtsState({ status: "checking" });

    try {
      const setup = await loadTtsSetup();
      setTtsSettingsDraft(setup.settings);
      setTtsState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const ttsError = toTtsError(error);
      setTtsState({ status: "error", message: ttsError.message });
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function checkTtsRuntime() {
      try {
        const setup = await loadTtsSetup();

        if (!ignore) {
          setTtsSettingsDraft(setup.settings);
          setTtsState({ status: "loaded", setup, saving: false });
        }
      } catch (error) {
        if (!ignore) {
          const ttsError = toTtsError(error);
          setTtsState({ status: "error", message: ttsError.message });
        }
      }
    }

    void checkTtsRuntime();

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

  const saveTtsSettingsAction = async () => {
    if (ttsState.status !== "loaded") {
      return;
    }

    const previousSetup = ttsState.setup;
    setTtsState({ status: "loaded", setup: previousSetup, saving: true });

    try {
      const setup = await persistTtsSettings(ttsSettingsDraft);
      setTtsSettingsDraft(setup.settings);
      setTtsState({ status: "loaded", setup, saving: false });
    } catch (error) {
      const ttsError = toTtsError(error);
      setTtsState({
        status: "loaded",
        setup: previousSetup,
        saving: false,
        saveError: ttsError.message,
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
  const ttsSettingsDirty =
    ttsState.status === "loaded" &&
    !ttsSettingsEqual(ttsSettingsDraft, ttsState.setup.settings);

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

  const resetTtsSettingsDraft = () => {
    if (ttsState.status === "loaded") {
      setTtsSettingsDraft(ttsState.setup.settings);
    }
  };

  return {
    healthState,
    reloadTranscriptionSetup,
    reloadTtsSetup,
    reloadTutorSetup,
    resetSettingsDraft,
    resetTtsSettingsDraft,
    resetTutorSettingsDraft,
    saveSettings,
    saveTtsSettings: saveTtsSettingsAction,
    saveTutorSettings,
    settingsDirty,
    settingsDraft,
    setSettingsDraft,
    setTtsSettingsDraft,
    setTutorSettingsDraft,
    transcriptionReady,
    transcriptionState,
    ttsSettingsDirty,
    ttsSettingsDraft,
    ttsState,
    tutorReady,
    tutorSettingsDirty,
    tutorSettingsDraft,
    tutorState,
  };
}
