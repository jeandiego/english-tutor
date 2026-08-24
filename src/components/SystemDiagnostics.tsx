import type { HealthState } from "../types/runtime";

export type TranscriptionDiagnostic = {
  status: "checking" | "ready" | "error";
  message: string;
  canOpenSettings: boolean;
};

export type TutorDiagnostic = {
  status: "checking" | "ready" | "error";
  message: string;
  meta?: string;
  canOpenSettings: boolean;
};

type SystemDiagnosticsProps = {
  healthState: HealthState;
  transcription: TranscriptionDiagnostic;
  tutor: TutorDiagnostic;
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

function compactStatus(
  status: "checking" | "ready" | "error",
  message: string,
  runtime: "transcription" | "tutor",
) {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "checking") {
    return message.startsWith("Verifying") ? "Verifying" : "Checking";
  }

  const localPrefix = `Local ${runtime} `;
  const compactMessage = message.startsWith(localPrefix)
    ? message.slice(localPrefix.length)
    : message;

  return compactMessage.charAt(0).toUpperCase() + compactMessage.slice(1);
}

type RuntimeCopyProps = {
  label: string;
  message: string;
  statusText: string;
  meta?: string;
};

function RuntimeCopy({ label, message, statusText, meta }: RuntimeCopyProps) {
  const statusIsFullMessage = statusText === message;

  return (
    <div className="system-diagnostics__copy">
      <p className="system-diagnostics__runtime" aria-hidden="true">
        {label}
      </p>
      <p className="system-diagnostics__status">
        {!statusIsFullMessage && (
          <span className="visually-hidden">{message}</span>
        )}
        <span aria-hidden={statusIsFullMessage ? undefined : "true"}>
          {statusText}
        </span>
        {meta && (
          <>
            <span className="system-diagnostics__separator" aria-hidden="true">
              {" · "}
            </span>
            <span className="system-diagnostics__meta">{meta}</span>
          </>
        )}
      </p>
    </div>
  );
}

export function SystemDiagnostics({
  healthState,
  transcription,
  tutor,
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
          <RuntimeCopy
            label="Desktop"
            message={
              healthState.status === "checking"
                ? "Checking desktop runtime"
                : healthState.status === "ready"
                  ? "Desktop runtime ready"
                  : "Desktop runtime unavailable"
            }
            statusText={
              healthState.status === "checking"
                ? "Checking"
                : healthState.status === "ready"
                  ? "Ready"
                  : "Unavailable"
            }
            meta={
              healthState.status === "ready"
                ? `${healthState.health.operatingSystem} · ${healthState.health.architecture}`
                : undefined
            }
          />
          {healthState.status === "error" && (
            <>
              <span className="system-diagnostics__guidance">
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
          <RuntimeCopy
            label="Transcription"
            message={transcription.message}
            statusText={compactStatus(
              transcription.status,
              transcription.message,
              "transcription",
            )}
          />
          {transcription.canOpenSettings && (
            <button
              aria-label="Open transcription settings"
              className="system-diagnostics__action"
              onClick={onOpenSettings}
              type="button"
            >
              Open settings
            </button>
          )}
        </div>

        <div
          className="system-diagnostics__item"
          aria-live={tutor.status === "error" ? "assertive" : "polite"}
        >
          {stateIndicator(tutor.status)}
          <RuntimeCopy
            label="Tutor"
            message={tutor.message}
            statusText={compactStatus(tutor.status, tutor.message, "tutor")}
            meta={tutor.status === "ready" ? tutor.meta : undefined}
          />
          {tutor.canOpenSettings && (
            <button
              aria-label="Open tutor settings"
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
