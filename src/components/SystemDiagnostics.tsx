import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { cn } from "../lib/utils";
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

const INDICATOR_CLASS: Record<Status, string> = {
  ready: "bg-success",
  checking: "bg-muted-foreground animate-pulse",
  error: "bg-destructive",
};

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", INDICATOR_CLASS[status])}
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
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p aria-hidden="true" className="text-caption font-medium text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-body text-foreground">
        {!statusIsFullMessage && <span className="sr-only">{message}</span>}
        <span aria-hidden={statusIsFullMessage ? undefined : "true"}>{statusText}</span>
        {meta && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {" · "}
            </span>
            <span className="text-muted-foreground">{meta}</span>
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
    <Popover open={expanded} onOpenChange={setManualOpen}>
      <PopoverTrigger
        aria-label={`System status: ${summaryLabel}`}
        className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-body hover:bg-accent"
      >
        <StatusDot status={overall} />
        <span className="min-w-0 flex-1 truncate text-foreground">{summaryLabel}</span>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </PopoverTrigger>

      <PopoverContent align="start" aria-label="System status details" side="right">
        <div
          className="flex items-start gap-2 py-1"
          aria-live={healthState.status === "error" ? "assertive" : "polite"}
        >
          <div className="pt-1.5">
            <StatusDot status={healthState.status} />
          </div>
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
            <div className="flex flex-col gap-1 text-caption text-muted-foreground">
              <span>Restart the desktop app and try again.</span>
              <details>
                <summary className="cursor-pointer">Details</summary>
                <code className="block whitespace-pre-wrap">{healthState.message}</code>
              </details>
            </div>
          )}
        </div>

        <div
          className="flex items-start gap-2 border-t border-border py-1 pt-2"
          aria-live={transcription.status === "error" ? "assertive" : "polite"}
        >
          <div className="pt-1.5">
            <StatusDot status={transcription.status} />
          </div>
          <RuntimeCopy
            label="Transcription"
            message={transcription.message}
            statusText={compactStatus(transcription.status, transcription.message, "transcription")}
          />
          {transcription.canOpenSettings && (
            <button
              aria-label="Open transcription settings"
              className="shrink-0 text-caption font-medium text-primary hover:underline"
              onClick={onOpenSettings}
              type="button"
            >
              Open settings
            </button>
          )}
        </div>

        <div
          className="flex items-start gap-2 border-t border-border py-1 pt-2"
          aria-live={tutor.status === "error" ? "assertive" : "polite"}
        >
          <div className="pt-1.5">
            <StatusDot status={tutor.status} />
          </div>
          <RuntimeCopy
            label="Tutor"
            message={tutor.message}
            statusText={compactStatus(tutor.status, tutor.message, "tutor")}
            meta={tutor.status === "ready" ? tutor.meta : undefined}
          />
          {tutor.canOpenSettings && (
            <button
              aria-label="Open tutor settings"
              className="shrink-0 text-caption font-medium text-primary hover:underline"
              onClick={onOpenSettings}
              type="button"
            >
              Open settings
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
