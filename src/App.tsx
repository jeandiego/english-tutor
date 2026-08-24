import { useState } from "react";
import { AppHeader, type AppPage } from "./components/AppHeader";
import { ConversationStage } from "./components/ConversationStage";
import { SettingsPage } from "./components/SettingsPage";
import { SystemDiagnostics } from "./components/SystemDiagnostics";
import type { TranscriptionDiagnostic } from "./components/SystemDiagnostics";
import { TalkControl } from "./components/TalkControl";
import { usePushToTalk } from "./hooks/usePushToTalk";
import { useRuntimeSetup } from "./hooks/useRuntimeSetup";
import "./App.css";

function App() {
  const [activePage, setActivePage] = useState<AppPage>("conversation");
  const {
    healthState,
    reloadTranscriptionSetup,
    resetSettingsDraft,
    saveSettings,
    settingsDirty,
    settingsDraft,
    setSettingsDraft,
    transcriptionReady,
    transcriptionState,
  } = useRuntimeSetup();
  const recording = usePushToTalk({
    enabled:
      activePage === "conversation" &&
      healthState.status === "ready" &&
      transcriptionReady,
  });
  const voiceBusy =
    recording.state.status === "requesting" ||
    recording.state.status === "recording" ||
    recording.state.status === "transcribing";
  const settingsNeedsAttention =
    transcriptionState.status === "error" ||
    (transcriptionState.status === "loaded" &&
      transcriptionState.setup.preflight.status !== "ready");
  const voiceDisabledHint =
    healthState.status !== "ready"
      ? "Voice input is available when the desktop runtime is ready"
      : transcriptionState.status === "checking"
        ? "Voice input is available after the local transcription check"
        : !transcriptionReady
          ? "Open Settings to complete local transcription setup"
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

  return (
    <main
      className={`coach-shell coach-shell--${activePage}`}
      data-page={activePage}
    >
      <AppHeader
        activePage={activePage}
        onNavigate={setActivePage}
        settingsNavigationDisabled={voiceBusy}
        settingsNeedsAttention={settingsNeedsAttention}
      />

      {activePage === "conversation" ? (
        <>
          <ConversationStage state={recording.state} />
          <TalkControl
            disabled={
              healthState.status !== "ready" ||
              !transcriptionReady ||
              recording.state.status === "transcribing"
            }
            disabledHint={voiceDisabledHint}
            onEnd={(owner) => void recording.end(owner)}
            onStart={(owner) => void recording.begin(owner)}
            state={recording.state}
          />
          <SystemDiagnostics
            healthState={healthState}
            onOpenSettings={() => setActivePage("settings")}
            transcription={transcriptionDiagnostic}
          />
        </>
      ) : (
        <SettingsPage
          dirty={settingsDirty}
          draft={settingsDraft}
          onDraftChange={setSettingsDraft}
          onReset={resetSettingsDraft}
          onRetry={reloadTranscriptionSetup}
          onSave={saveSettings}
          state={transcriptionState}
        />
      )}
    </main>
  );
}

export default App;
