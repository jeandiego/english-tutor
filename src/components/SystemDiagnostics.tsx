import type { HealthState } from "../types/runtime";

type SystemDiagnosticsProps = {
  state: HealthState;
};

const STATUS_LABELS: Record<HealthState["status"], string> = {
  checking: "Checking",
  ready: "Ready",
  error: "Error",
};

export function SystemDiagnostics({ state }: SystemDiagnosticsProps) {
  const stateLabel = STATUS_LABELS[state.status];

  return (
    <section
      className="system-diagnostics"
      aria-labelledby="system-title"
      aria-live={state.status === "error" ? "assertive" : "polite"}
    >
      <h2 id="system-title">System</h2>
      <div className="system-diagnostics__content">
        <span
          className={`system-diagnostics__indicator system-diagnostics__indicator--${state.status}`}
          aria-hidden="true"
        />
        <p className="system-diagnostics__message">
          <span className="visually-hidden">{stateLabel}: </span>
          {state.status === "checking" && "Checking desktop runtime"}
          {state.status === "ready" && "Desktop runtime ready"}
          {state.status === "error" && "Desktop runtime unavailable"}
        </p>

        {state.status === "ready" && (
          <dl className="runtime-details">
            <div>
              <dt>Operating system</dt>
              <dd>{state.health.operatingSystem}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{state.health.architecture}</dd>
            </div>
          </dl>
        )}

        {state.status === "error" && (
          <div className="system-diagnostics__error">
            <span>Restart the desktop app and try again.</span>
            <details>
              <summary>Technical details</summary>
              <code>{state.message}</code>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
