import {
  SystemDiagnostics,
  type TranscriptionDiagnostic,
  type TutorDiagnostic,
} from "./SystemDiagnostics";
import type { HealthState } from "../types/runtime";

export type AppPage = "conversation" | "history" | "settings";

type AppHeaderProps = {
  activePage: AppPage;
  settingsNeedsAttention: boolean;
  navigationDisabled: boolean;
  onNavigate: (page: AppPage) => void;
  healthState: HealthState;
  transcription: TranscriptionDiagnostic;
  tutor: TutorDiagnostic;
  onOpenSettings: () => void;
};

export function AppHeader({
  activePage,
  settingsNeedsAttention,
  navigationDisabled,
  onNavigate,
  healthState,
  transcription,
  tutor,
  onOpenSettings,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <nav className="app-navigation" aria-label="Primary navigation">
        <button
          aria-current={activePage === "conversation" ? "page" : undefined}
          className="app-navigation__item"
          onClick={() => onNavigate("conversation")}
          type="button"
        >
          Conversation
        </button>
        <button
          aria-current={activePage === "history" ? "page" : undefined}
          className="app-navigation__item"
          disabled={navigationDisabled}
          onClick={() => onNavigate("history")}
          type="button"
        >
          History
        </button>
        <button
          aria-label={
            settingsNeedsAttention ? "Settings, needs attention" : "Settings"
          }
          aria-current={activePage === "settings" ? "page" : undefined}
          className="app-navigation__item"
          disabled={navigationDisabled}
          onClick={() => onNavigate("settings")}
          type="button"
        >
          Settings
          {settingsNeedsAttention && (
            <span
              className="app-navigation__attention"
              aria-hidden="true"
            />
          )}
        </button>
      </nav>

      <h1>English Coach</h1>

      <SystemDiagnostics
        healthState={healthState}
        onOpenSettings={onOpenSettings}
        transcription={transcription}
        tutor={tutor}
      />
    </header>
  );
}
