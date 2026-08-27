import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader, type AppPage } from "./components/AppHeader";
import { AssessmentPage } from "./components/AssessmentPage";
import { ConversationStage } from "./components/ConversationStage";
import { HistoryPage } from "./components/HistoryPage";
import { ProgressPage } from "./components/ProgressPage";
import { SessionsPage } from "./components/SessionsPage";
import { SettingsPage } from "./components/SettingsPage";
import type {
  TranscriptionDiagnostic,
  TutorDiagnostic,
} from "./components/SystemDiagnostics";
import { TalkControl } from "./components/TalkControl";
import { useRuntimeSetup } from "./hooks/useRuntimeSetup";
import { useSessionHistory } from "./hooks/useSessionHistory";
import { useTutorConversation } from "./hooks/useTutorConversation";
import { getLatestAssessment } from "./native/assessment";
import { assessmentKeys } from "./queryKeys/assessment";
import "./App.css";

function App() {
  const [activePage, setActivePage] = useState<AppPage>("conversation");
  const queryClient = useQueryClient();
  const latestAssessmentQuery = useQuery({
    queryKey: assessmentKeys.latest(),
    queryFn: getLatestAssessment,
  });
  const estimatedLevel = latestAssessmentQuery.data?.estimatedLevel ?? undefined;
  const {
    healthState,
    reloadTranscriptionSetup,
    reloadTtsSetup,
    reloadTutorSetup,
    resetSettingsDraft,
    resetTtsSettingsDraft,
    resetTutorSettingsDraft,
    saveSettings,
    saveTtsSettings,
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
  } = useRuntimeSetup();
  const sessionHistory = useSessionHistory();
  const repairIntensity =
    tutorState.status === "loaded" ? tutorState.setup.settings.repairIntensity : undefined;
  const conversation = useTutorConversation({
    enabled:
      activePage === "conversation" &&
      healthState.status === "ready" &&
      transcriptionReady &&
      tutorReady,
    sessionId: sessionHistory.sessionId,
    learnerContext: sessionHistory.learnerContext,
    repairIntensity,
  });
  const voiceBusy =
    conversation.state.status === "requesting" ||
    conversation.state.status === "recording" ||
    conversation.state.status === "transcribing" ||
    conversation.thinking ||
    conversation.speaking;
  const settingsNeedsAttention =
    transcriptionState.status === "error" ||
    (transcriptionState.status === "loaded" &&
      transcriptionState.setup.preflight.status !== "ready") ||
    tutorState.status === "error" ||
    (tutorState.status === "loaded" &&
      tutorState.setup.preflight.status !== "ready");
  const voiceDisabledHint =
    healthState.status !== "ready"
      ? "Voice input is available when the desktop runtime is ready"
      : transcriptionState.status === "checking"
        ? "Voice input is available after the local transcription check"
        : !transcriptionReady
          ? "Open Settings to complete local transcription setup"
          : tutorState.status === "checking"
            ? "Voice input is available after the local tutor check"
            : !tutorReady
              ? "Open Settings to complete local tutor setup"
              : undefined;
  const transcriptionDiagnostic: TranscriptionDiagnostic =
    transcriptionState.status === "checking" ||
    (transcriptionState.status === "loaded" && transcriptionState.saving)
      ? {
          status: "checking",
          message:
            transcriptionState.status === "loaded"
              ? "Verifying local transcription"
              : "Checking local transcription",
          canOpenSettings: false,
        }
      : transcriptionReady
        ? {
            status: "ready",
            message: "Local transcription ready",
            canOpenSettings: false,
          }
        : {
            status: "error",
            message:
              transcriptionState.status === "error"
                ? "Local transcription unavailable"
                : "Local transcription needs setup",
            canOpenSettings: true,
          };
  const tutorDiagnostic: TutorDiagnostic =
    tutorState.status === "checking" ||
    (tutorState.status === "loaded" && tutorState.saving)
      ? {
          status: "checking",
          message:
            tutorState.status === "loaded"
              ? "Verifying local tutor"
              : "Checking local tutor",
          canOpenSettings: false,
        }
      : tutorReady
        ? {
            status: "ready",
            message: "Local tutor ready",
            meta:
              tutorState.status === "loaded"
                ? tutorState.setup.settings.modelName
                : undefined,
            canOpenSettings: false,
          }
        : {
            status: "error",
            message:
              tutorState.status === "error"
                ? "Local tutor unavailable"
                : tutorState.setup.preflight.status === "ollamaUnavailable"
                  ? "Ollama unavailable"
                  : tutorState.setup.preflight.status === "noModelConfigured"
                    ? "Tutor model not configured"
                    : "Tutor model unavailable",
            canOpenSettings: true,
          };

  return (
    <main
      className={`coach-shell coach-shell--${activePage}`}
      data-page={activePage}
    >
      <AppHeader
        activePage={activePage}
        estimatedLevel={estimatedLevel}
        healthState={healthState}
        navigationDisabled={voiceBusy}
        onNavigate={setActivePage}
        onOpenSettings={() => setActivePage("settings")}
        settingsNeedsAttention={settingsNeedsAttention}
        transcription={transcriptionDiagnostic}
        tutor={tutorDiagnostic}
      />

      {activePage === "conversation" ? (
        <>
          <ConversationStage
            exchanges={conversation.exchanges}
            historyWarning={sessionHistory.startError?.message}
            loopState={conversation.loopState}
            onReplay={conversation.replay}
            onSkipRepair={conversation.skipRepair}
            replayState={conversation.replayState}
            speaking={conversation.speaking}
            state={conversation.state}
            thinking={conversation.thinking}
          />
          <TalkControl
            disabled={
              healthState.status !== "ready" ||
              !transcriptionReady ||
              !tutorReady ||
              conversation.state.status === "transcribing" ||
              conversation.thinking ||
              conversation.speaking
            }
            disabledHint={voiceDisabledHint}
            onEnd={(owner) => void conversation.end(owner)}
            onStart={(owner) => void conversation.begin(owner)}
            speaking={conversation.speaking}
            state={conversation.state}
            thinking={conversation.thinking}
          />
        </>
      ) : activePage === "sessions" ? (
        <SessionsPage
          disabled={
            healthState.status !== "ready" || !transcriptionReady || !tutorReady
          }
          disabledHint={voiceDisabledHint}
          repairIntensity={repairIntensity}
        />
      ) : activePage === "assessment" ? (
        <AssessmentPage
          disabled={
            healthState.status !== "ready" || !transcriptionReady || !tutorReady
          }
          disabledHint={voiceDisabledHint}
          onAssessmentCompleted={() =>
            void queryClient.invalidateQueries({
              queryKey: assessmentKeys.latest(),
            })
          }
        />
      ) : activePage === "history" ? (
        <HistoryPage />
      ) : activePage === "progress" ? (
        <ProgressPage />
      ) : (
        <SettingsPage
          onTranscriptionDraftChange={setSettingsDraft}
          onTranscriptionReset={resetSettingsDraft}
          onTranscriptionRetry={reloadTranscriptionSetup}
          onTranscriptionSave={saveSettings}
          onTtsDraftChange={setTtsSettingsDraft}
          onTtsReset={resetTtsSettingsDraft}
          onTtsRetry={reloadTtsSetup}
          onTtsSave={saveTtsSettings}
          onTutorDraftChange={setTutorSettingsDraft}
          onTutorReset={resetTutorSettingsDraft}
          onTutorRetry={reloadTutorSetup}
          onTutorSave={saveTutorSettings}
          transcriptionDirty={settingsDirty}
          transcriptionDraft={settingsDraft}
          transcriptionState={transcriptionState}
          ttsDirty={ttsSettingsDirty}
          ttsDraft={ttsSettingsDraft}
          ttsState={ttsState}
          tutorDirty={tutorSettingsDirty}
          tutorDraft={tutorSettingsDraft}
          tutorState={tutorState}
        />
      )}
    </main>
  );
}

export default App;
