import { useState } from "react";
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

type Status = "checking" | "ready" | "error";

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function stateIndicator(status: Status) {
  return (
    <span
      className={`system-status__indicator system-status__indicator--${status}`}
      aria-hidden="true"
    />
  );
}

function compactStatus(status: Status, message: string, runtime: "transcription" | "tutor") {
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
    <div className="system-status__copy">
      <p className="system-status__runtime" aria-hidden="true">
        {label}
      </p>
      <p className="system-status__status">
        {!statusIsFullMessage && (
          <span className="visually-hidden">{message}</span>
        )}
        <span aria-hidden={statusIsFullMessage ? undefined : "true"}>
          {statusText}
        </span>
        {meta && (
          <>
            <span className="system-status__separator" aria-hidden="true">
              {" · "}
            </span>
            <span className="system-status__meta">{meta}</span>
          </>
        )}
      </p>
    </div>
  );
}

function overallStatusOf(statuses: Status[]): Status {
  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.some((status) => status === "checking")) {
    return "checking";
  }

  return "ready";
}

function summaryLabelFor(overall: Status, errorCount: number): string {
  if (overall === "ready") {
    return "All systems ready";
  }

  if (overall === "checking") {
    return "Checking systems…";
  }

  return errorCount > 1 ? `${errorCount} issues` : "1 issue";
}

export function SystemDiagnostics({
  healthState,
  transcription,
  tutor,
  onOpenSettings,
}: SystemDiagnosticsProps) {
  const statuses: Status[] = [healthState.status, transcription.status, tutor.status];
  const overall = overallStatusOf(statuses);
  const errorCount = statuses.filter((status) => status === "error").length;
  const summaryLabel = summaryLabelFor(overall, errorCount);
  const [manualOpen, setManualOpen] = useState(() => overall !== "ready");
  const expanded = manualOpen || overall !== "ready";

  return (
    <div className="system-status">
      <button
        aria-expanded={expanded}
        aria-label={`System status: ${summaryLabel}`}
        className="system-status__toggle"
        onClick={() => setManualOpen((value) => !value)}
        type="button"
      >
        {stateIndicator(overall)}
        <span className="system-status__label">{summaryLabel}</span>
        <ChevronIcon
          className={expanded ? "system-status__chevron is-open" : "system-status__chevron"}
        />
      </button>

      {expanded && (
        <div className="system-status__panel" aria-label="System status details">
          <div
            className="system-status__item"
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
                <span className="system-status__guidance">
                  Restart the desktop app and try again.
                </span>
                <details className="system-status__details">
                  <summary>Details</summary>
                  <code>{healthState.message}</code>
                </details>
              </>
            )}
          </div>

          <div
            className="system-status__item"
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
                className="system-status__action"
                onClick={onOpenSettings}
                type="button"
              >
                Open settings
              </button>
            )}
          </div>

          <div
            className="system-status__item"
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
                className="system-status__action"
                onClick={onOpenSettings}
                type="button"
              >
                Open settings
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
