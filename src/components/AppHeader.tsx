import {
  SystemDiagnostics,
  type TranscriptionDiagnostic,
  type TutorDiagnostic,
} from "./SystemDiagnostics";
import type { HealthState } from "../types/runtime";

export type AppPage = "conversation" | "assessment" | "history" | "settings";

type AppHeaderProps = {
  activePage: AppPage;
  settingsNeedsAttention: boolean;
  navigationDisabled: boolean;
  onNavigate: (page: AppPage) => void;
  healthState: HealthState;
  transcription: TranscriptionDiagnostic;
  tutor: TutorDiagnostic;
  onOpenSettings: () => void;
  estimatedLevel?: string;
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
  estimatedLevel,
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
          aria-current={activePage === "assessment" ? "page" : undefined}
          className="app-navigation__item"
          disabled={navigationDisabled}
          onClick={() => onNavigate("assessment")}
          type="button"
        >
          Assessment
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

      <div className="app-header__trailing">
        {estimatedLevel && (
          <span className="local-status" aria-label={`Estimated level ${estimatedLevel}`}>
            {estimatedLevel} estimated
          </span>
        )}
        <SystemDiagnostics
          healthState={healthState}
          onOpenSettings={onOpenSettings}
          transcription={transcription}
          tutor={tutor}
        />
      </div>
    </header>
  );
}
