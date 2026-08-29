import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getRuntimeHealth } from "../native/health";
import { runtimeKeys } from "../queryKeys/runtime";
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
import type { TtsProviderId, TtsSettings, TtsSetupState } from "../types/tts";
import type { TutorSettings, TutorSetupState } from "../types/tutor";

const DEFAULT_SETTINGS: TranscriptionSettings = {
  whisperExecutablePath: "",
  whisperModelPath: "",
  ffmpegExecutablePath: "ffmpeg",
};

const DEFAULT_TUTOR_SETTINGS: TutorSettings = {
  baseUrl: "http://127.0.0.1:11434",
  modelName: "",
  thinkingEnabled: false,
  repairIntensity: "balanced",
};

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: "macos_say",
  voiceId: "",
  kokoroExecutablePath: "",
  kokoroModelPath: "",
  kokoroVoicesPath: "",
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
    left.thinkingEnabled === right.thinkingEnabled &&
    left.repairIntensity === right.repairIntensity
  );
}

function ttsSettingsEqual(left: TtsSettings, right: TtsSettings) {
  return (
    left.provider === right.provider &&
    left.voiceId === right.voiceId &&
    left.rate === right.rate &&
    left.volume === right.volume &&
    left.kokoroExecutablePath === right.kokoroExecutablePath &&
    left.kokoroModelPath === right.kokoroModelPath &&
    left.kokoroVoicesPath === right.kokoroVoicesPath
  );
}

type SetupStatus<TSetup> =
  | { status: "checking" }
  | { status: "loaded"; setup: TSetup; saving: boolean; saveError?: string }
  | { status: "error"; message: string };

function toSetupState<TSetup>(
  query: Pick<UseQueryResult<TSetup>, "isPending" | "isError" | "error" | "data">,
  mutation: Pick<UseMutationResult<TSetup, unknown, unknown>, "isPending" | "error">,
  toErrorMessage: (error: unknown) => string,
): SetupStatus<TSetup> {
  if (query.isPending) {
    return { status: "checking" };
  }
  if (query.isError) {
    return { status: "error", message: toErrorMessage(query.error) };
  }
  return {
    status: "loaded",
    setup: query.data as TSetup,
    saving: mutation.isPending,
    saveError: mutation.error ? toErrorMessage(mutation.error) : undefined,
  };
}

export function useRuntimeSetup() {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: runtimeKeys.health(),
    queryFn: getRuntimeHealth,
  });
  const healthState: HealthState = healthQuery.isPending
    ? { status: "checking" }
    : healthQuery.isError
      ? {
          status: "error",
          message:
            healthQuery.error instanceof Error
              ? healthQuery.error.message
              : String(healthQuery.error),
        }
      : { status: "ready", health: healthQuery.data };

  const transcriptionQuery = useQuery({
    queryKey: runtimeKeys.transcriptionSetup(),
    queryFn: loadTranscriptionSetup,
  });
  const transcriptionMutation = useMutation({
    mutationFn: (settings: TranscriptionSettings) =>
      saveTranscriptionSettings(settings),
  });
  const transcriptionState = toSetupState(
    transcriptionQuery,
    transcriptionMutation,
    (error) => toTranscriptionError(error).message,
  ) as TranscriptionSetupState;

  const tutorQuery = useQuery({
    queryKey: runtimeKeys.tutorSetup(),
    queryFn: loadTutorSetup,
  });
  const tutorMutation = useMutation({
    mutationFn: (settings: TutorSettings) => persistTutorSettings(settings),
  });
  const tutorState = toSetupState(
    tutorQuery,
    tutorMutation,
    (error) => toTutorError(error).message,
  ) as TutorSetupState;

  const ttsQuery = useQuery({
    queryKey: runtimeKeys.ttsSetup(),
    queryFn: loadTtsSetup,
  });
  const ttsMutation = useMutation({
    mutationFn: (settings: TtsSettings) => persistTtsSettings(settings),
  });
  const ttsState = toSetupState(
    ttsQuery,
    ttsMutation,
    (error) => toTtsError(error).message,
  ) as TtsSetupState;

  const [settingsDraft, setSettingsDraft] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [tutorSettingsDraft, setTutorSettingsDraft] = useState<TutorSettings>(
    DEFAULT_TUTOR_SETTINGS,
  );
  const [ttsSettingsDraft, setTtsSettingsDraft] = useState<TtsSettings>(
    DEFAULT_TTS_SETTINGS,
  );

  useEffect(() => {
    if (transcriptionQuery.data) {
      setSettingsDraft(transcriptionQuery.data.settings);
    }
  }, [transcriptionQuery.data]);

  useEffect(() => {
    if (tutorQuery.data) {
      setTutorSettingsDraft(tutorQuery.data.settings);
    }
  }, [tutorQuery.data]);

  useEffect(() => {
    if (ttsQuery.data) {
      setTtsSettingsDraft(ttsQuery.data.settings);
    }
  }, [ttsQuery.data]);

  const saveSettings = async () => {
    if (transcriptionState.status !== "loaded") {
      return;
    }
    try {
      const setup = await transcriptionMutation.mutateAsync(settingsDraft);
      queryClient.setQueryData(runtimeKeys.transcriptionSetup(), setup);
      setSettingsDraft(setup.settings);
    } catch {
      // surfaced via transcriptionState.saveError
    }
  };

  const saveTutorSettings = async () => {
    if (tutorState.status !== "loaded") {
      return;
    }
    try {
      const setup = await tutorMutation.mutateAsync(tutorSettingsDraft);
      queryClient.setQueryData(runtimeKeys.tutorSetup(), setup);
      setTutorSettingsDraft(setup.settings);
    } catch {
      // surfaced via tutorState.saveError
    }
  };

  const saveTtsSettingsAction = async () => {
    if (ttsState.status !== "loaded") {
      return;
    }
    try {
      const setup = await ttsMutation.mutateAsync(ttsSettingsDraft);
      queryClient.setQueryData(runtimeKeys.ttsSetup(), setup);
      setTtsSettingsDraft(setup.settings);
    } catch {
      // surfaced via ttsState.saveError
    }
  };

  const selectTtsVoice = async (provider: TtsProviderId, voiceId: string) => {
    if (ttsState.status !== "loaded") {
      return;
    }
    try {
      const setup = await ttsMutation.mutateAsync({
        ...ttsState.setup.settings,
        provider,
        voiceId,
      });
      queryClient.setQueryData(runtimeKeys.ttsSetup(), setup);
      setTtsSettingsDraft(setup.settings);
    } catch {
      // surfaced via ttsState.saveError
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
    reloadTranscriptionSetup: async () => {
      await transcriptionQuery.refetch();
    },
    reloadTtsSetup: async () => {
      await ttsQuery.refetch();
    },
    reloadTutorSetup: async () => {
      await tutorQuery.refetch();
    },
    resetSettingsDraft,
    resetTtsSettingsDraft,
    resetTutorSettingsDraft,
    saveSettings,
    saveTtsSettings: saveTtsSettingsAction,
    saveTutorSettings,
    selectTtsVoice,
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
