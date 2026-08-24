export type AppPage = "conversation" | "settings";

type AppHeaderProps = {
  activePage: AppPage;
  settingsNeedsAttention: boolean;
  settingsNavigationDisabled: boolean;
  onNavigate: (page: AppPage) => void;
};

export function AppHeader({
  activePage,
  settingsNeedsAttention,
  settingsNavigationDisabled,
  onNavigate,
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
          aria-label={
            settingsNeedsAttention ? "Settings, needs attention" : "Settings"
          }
          aria-current={activePage === "settings" ? "page" : undefined}
          className="app-navigation__item"
          disabled={settingsNavigationDisabled}
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

      <div className="local-status" aria-label="Runs locally">
        <span className="local-status__dot" aria-hidden="true" />
        <span>Local</span>
      </div>
    </header>
  );
}
