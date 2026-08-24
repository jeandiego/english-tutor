import type { HealthState } from "../types/runtime";

export type TranscriptionDiagnostic = {
  status: "checking" | "ready" | "error";
  message: string;
  canOpenSettings: boolean;
};

type SystemDiagnosticsProps = {
  healthState: HealthState;
  transcription: TranscriptionDiagnostic;
  onOpenSettings: () => void;
};

function stateIndicator(status: "checking" | "ready" | "error") {
  return (
    <span
      className={`system-diagnostics__indicator system-diagnostics__indicator--${status}`}
      aria-hidden="true"
    />
  );
}

export function SystemDiagnostics({
  healthState,
  transcription,
  onOpenSettings,
}: SystemDiagnosticsProps) {
  return (
    <section className="system-diagnostics" aria-labelledby="system-title">
      <h2 id="system-title">System</h2>
      <div className="system-diagnostics__items">
        <div
          className="system-diagnostics__item"
          aria-live={healthState.status === "error" ? "assertive" : "polite"}
        >
          {stateIndicator(healthState.status)}
          <p className="system-diagnostics__message">
            {healthState.status === "checking" && "Checking desktop runtime"}
            {healthState.status === "ready" && "Desktop runtime ready"}
            {healthState.status === "error" && "Desktop runtime unavailable"}
          </p>
          {healthState.status === "ready" && (
            <span className="system-diagnostics__meta">
              {healthState.health.operatingSystem} · {healthState.health.architecture}
            </span>
          )}
          {healthState.status === "error" && (
            <>
              <span className="system-diagnostics__meta system-diagnostics__meta--error">
                Restart the desktop app and try again.
              </span>
              <details className="system-diagnostics__details">
                <summary>Details</summary>
                <code>{healthState.message}</code>
              </details>
            </>
          )}
        </div>

        <div
          className="system-diagnostics__item"
          aria-live={transcription.status === "error" ? "assertive" : "polite"}
        >
          {stateIndicator(transcription.status)}
          <p className="system-diagnostics__message">{transcription.message}</p>
          {transcription.canOpenSettings && (
            <button
              className="system-diagnostics__action"
              onClick={onOpenSettings}
              type="button"
            >
              Open settings
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
