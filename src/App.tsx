import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { ErrorBoundary, getErrorMessage, type FallbackProps } from "react-error-boundary";
import { AssessmentPage } from "./components/AssessmentPage";
import { Composer } from "./components/Composer";
import { ConversationStage } from "./components/ConversationStage";
import { HistoryPage } from "./components/HistoryPage";
import { ProgressPage } from "./components/ProgressPage";
import { PronunciationPracticePage } from "./components/PronunciationPracticePage";
import { AppSidebar, type AppPage } from "./components/sidebar/AppSidebar";
import { SessionsPage } from "./components/SessionsPage";
import { SettingsPage } from "./components/SettingsPage";
import { StoragePage } from "./components/StoragePage";
import { WritingGymPage } from "./components/WritingGymPage";
import type {
  TranscriptionDiagnostic,
  TutorDiagnostic,
} from "./components/SystemDiagnostics";
import { TopBar } from "./components/TopBar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { useLiveConversation } from "./hooks/useLiveConversation";
import { useRuntimeSetup } from "./hooks/useRuntimeSetup";
import { useTutorConversation } from "./hooks/useTutorConversation";
import { SIDEBAR_WIDTH_PX } from "./lib/layout";
import { getLatestAssessment } from "./native/assessment";
import { assessmentKeys } from "./queryKeys/assessment";
import type { ConversationContinuePayload } from "./types/history";

function PageErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = getErrorMessage(error);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Alert variant="destructive">
        <AlertTitle>This page couldn&apos;t load</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <p>{message}</p>
          <details>
            <summary className="cursor-pointer">Technical details</summary>
            <code className="block whitespace-pre-wrap">{error instanceof Error ? error.stack : message}</code>
          </details>
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Button onClick={resetErrorBoundary} variant="outline">
          Try again
        </Button>
      </div>
    </section>
  );
}

const PAGE_HEADER: Record<AppPage, { eyebrow: string; title: string }> = {
  conversation: { eyebrow: "Conversation", title: "Live practice" },
  sessions: { eyebrow: "Sessions", title: "Choose a scenario" },
  assessment: { eyebrow: "Assessment", title: "Level check" },
  writing: { eyebrow: "Writing", title: "Writing gym" },
  history: { eyebrow: "History", title: "Past conversations" },
  progress: { eyebrow: "My Progress", title: "Learning trends" },
  pronunciation: { eyebrow: "Pronunciation", title: "Practice a phrase" },
  storage: { eyebrow: "Storage", title: "Local database" },
  settings: { eyebrow: "Settings", title: "Runtime & voice" },
};

function App() {
  const [activePage, setActivePage] = useState<AppPage>("conversation");
  const [focusSessionId, setFocusSessionId] = useState<number | undefined>();
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
    selectTtsVoice,
    selectTutorModel,
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
  const liveConversation = useLiveConversation();
  const repairIntensity =
    tutorState.status === "loaded" ? tutorState.setup.settings.repairIntensity : undefined;
  const conversation = useTutorConversation({
    enabled:
      activePage === "conversation" &&
      healthState.status === "ready" &&
      transcriptionReady &&
      tutorReady,
    sessionId: liveConversation.sessionId,
    learnerContext: liveConversation.learnerContext,
    seedMessages: liveConversation.seedMessages,
    dueReviewItems: liveConversation.dueReviewItems,
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
  const writingDisabledHint =
    healthState.status !== "ready"
      ? "Writing feedback is available when the desktop runtime is ready"
      : tutorState.status === "checking"
        ? "Writing feedback is available after the local tutor check"
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

  const navigate = (page: AppPage) => {
    setFocusSessionId(undefined);
    setActivePage(page);
  };

  const handleContinue = (payload: ConversationContinuePayload) => {
    const result = liveConversation.requestSwitch(
      payload.resume,
      payload.sourceTitle,
      payload.sourceStartedAt,
      conversation.liveTurnCount > 0,
    );
    if (result === "switched") {
      navigate("conversation");
    }
  };

  return (
    <SidebarProvider
      className="h-svh"
      data-page={activePage}
      style={{ "--sidebar-width": `${SIDEBAR_WIDTH_PX}px` } as CSSProperties}
    >
      <AppSidebar
        activePage={activePage}
        estimatedLevel={estimatedLevel}
        healthState={healthState}
        navigationDisabled={voiceBusy}
        onNavigate={navigate}
        onOpenSession={(sessionId) => {
          setFocusSessionId(sessionId);
          setActivePage("history");
        }}
        onOpenSettings={() => navigate("settings")}
        onSelectVoice={(provider, voiceId) => void selectTtsVoice(provider, voiceId)}
        settingsNeedsAttention={settingsNeedsAttention}
        transcription={transcriptionDiagnostic}
        ttsState={ttsState}
        tutor={tutorDiagnostic}
      />
      <SidebarInset>
        <TopBar
          eyebrow={PAGE_HEADER[activePage].eyebrow}
          newSessionDisabled={voiceBusy}
          onNewSession={() => navigate("sessions")}
          title={PAGE_HEADER[activePage].title}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-10">
          <ErrorBoundary
            FallbackComponent={PageErrorFallback}
            onError={(error) => console.error("Page content crashed:", error)}
            resetKeys={[activePage, focusSessionId]}
          >
          {activePage === "conversation" ? (
        <>
          <ConversationStage
            exchanges={conversation.exchanges}
            historyWarning={liveConversation.startError?.message}
            loopState={conversation.loopState}
            onReplay={conversation.replay}
            onSkipRepair={conversation.skipRepair}
            replayState={conversation.replayState}
            resumeBanner={liveConversation.resumeBanner}
            speaking={conversation.speaking}
            state={conversation.state}
            thinking={conversation.thinking}
          />
          <Composer
            currentModel={tutorState.status === "loaded" ? tutorState.setup.settings.modelName : undefined}
            disabled={voiceBusy || healthState.status !== "ready" || !transcriptionReady || !tutorReady}
            disabledHint={voiceDisabledHint}
            modelPickerDisabled={tutorState.status !== "loaded" || tutorState.saving}
            models={tutorState.status === "loaded" ? tutorState.setup.preflight.availableModels : []}
            onRecordEnd={(owner) => void conversation.end(owner)}
            onRecordStart={(owner) => void conversation.begin(owner)}
            onSelectModel={(name) => void selectTutorModel(name)}
            onSend={(text) => conversation.sendTypedMessage(text)}
            recordingState={conversation.state}
            speaking={conversation.speaking}
            thinking={conversation.thinking}
          />
        </>
      ) : activePage === "sessions" ? (
        <SessionsPage
          currentModel={tutorState.status === "loaded" ? tutorState.setup.settings.modelName : undefined}
          disabled={
            healthState.status !== "ready" || !transcriptionReady || !tutorReady
          }
          disabledHint={voiceDisabledHint}
          modelPickerDisabled={tutorState.status !== "loaded" || tutorState.saving}
          models={tutorState.status === "loaded" ? tutorState.setup.preflight.availableModels : []}
          onSelectModel={(name) => void selectTutorModel(name)}
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
      ) : activePage === "writing" ? (
        <WritingGymPage
          disabled={healthState.status !== "ready" || !tutorReady}
          disabledHint={writingDisabledHint}
        />
      ) : activePage === "history" ? (
        <HistoryPage
          focusSessionId={focusSessionId}
          onContinue={handleContinue}
          onSelectSession={setFocusSessionId}
        />
      ) : activePage === "progress" ? (
        <ProgressPage />
      ) : activePage === "pronunciation" ? (
        <PronunciationPracticePage
          disabled={healthState.status !== "ready" || !transcriptionReady}
          disabledHint={voiceDisabledHint}
        />
      ) : activePage === "storage" ? (
        <StoragePage />
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
          </ErrorBoundary>
        </div>
      </SidebarInset>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            liveConversation.cancelPendingSwitch();
          }
        }}
        open={liveConversation.pendingResume !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch your active conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              You have an ongoing conversation. Continuing &quot;
              {liveConversation.pendingResume?.sourceTitle}&quot; will make it your active
              conversation instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => liveConversation.cancelPendingSwitch()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                liveConversation.confirmPendingSwitch();
                navigate("conversation");
              }}
            >
              Switch conversation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

export default App;
