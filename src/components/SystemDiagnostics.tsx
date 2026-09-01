import { IconChevronDown, IconSettings } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { cn } from "../lib/utils";
import type { HealthState } from "../types/runtime";
import type { SettingsSectionId } from "./settings/SettingsModal";

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
  onOpenSettings: (section?: SettingsSectionId) => void;
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

type DiagnosticRowProps = {
  status: Status;
  label: string;
  message: string;
  statusText: string;
  meta?: string;
  action?: { label: string; onClick: () => void };
  detail?: ReactNode;
};

function DiagnosticRow({ status, label, message, statusText, meta, action, detail }: DiagnosticRowProps) {
  const statusIsFullMessage = statusText === message;

  return (
    <div
      aria-live={status === "error" ? "assertive" : "polite"}
      className="flex flex-col gap-1 py-1.5 first:pt-0 last:pb-0"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={status} />
        <span className="shrink-0 text-caption font-medium text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-body text-foreground">
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
        </span>
        {action && (
          <button
            aria-label={action.label}
            className="shrink-0 text-caption font-medium text-primary hover:underline"
            onClick={action.onClick}
            type="button"
          >
            Settings
          </button>
        )}
      </div>
      {detail && <div className="pl-4 text-caption text-muted-foreground">{detail}</div>}
    </div>
  );
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
  const expanded = manualOpen;

  return (
    <Popover open={expanded} onOpenChange={setManualOpen}>
      <PopoverTrigger
        aria-label={`System status: ${summaryLabel}`}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body hover:bg-foreground/5",
          overall !== "ready" && "border border-destructive/24 bg-destructive/5 hover:bg-destructive/10",
        )}
      >
        <StatusDot status={overall} />
        <span className="min-w-0 flex-1 truncate text-foreground">{summaryLabel}</span>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "-rotate-90",
          )}
        />
      </PopoverTrigger>

      <PopoverContent align="start" aria-label="System status details" className="w-72 gap-0 p-2" side="right">
        <div className="flex flex-col divide-y divide-border">
          <DiagnosticRow
            label="Desktop"
            message={
              healthState.status === "checking"
                ? "Checking desktop runtime"
                : healthState.status === "ready"
                  ? "Desktop runtime ready"
                  : "Desktop runtime unavailable"
            }
            meta={
              healthState.status === "ready"
                ? `${healthState.health.operatingSystem} · ${healthState.health.architecture}`
                : undefined
            }
            status={healthState.status}
            statusText={
              healthState.status === "checking"
                ? "Checking"
                : healthState.status === "ready"
                  ? "Ready"
                  : "Unavailable"
            }
            detail={
              healthState.status === "error" ? (
                <div className="flex flex-col gap-0.5">
                  <span>Restart the desktop app and try again.</span>
                  <details>
                    <summary className="cursor-pointer">Details</summary>
                    <code className="block whitespace-pre-wrap">{healthState.message}</code>
                  </details>
                </div>
              ) : undefined
            }
          />

          <DiagnosticRow
            action={
              transcription.canOpenSettings
                ? { label: "Open transcription settings", onClick: () => onOpenSettings("transcription") }
                : undefined
            }
            label="Transcription"
            message={transcription.message}
            status={transcription.status}
            statusText={compactStatus(transcription.status, transcription.message, "transcription")}
          />

          <DiagnosticRow
            action={
              tutor.canOpenSettings
                ? { label: "Open tutor settings", onClick: () => onOpenSettings("tutor") }
                : undefined
            }
            label="Tutor"
            message={tutor.message}
            meta={tutor.status === "ready" ? tutor.meta : undefined}
            status={tutor.status}
            statusText={compactStatus(tutor.status, tutor.message, "tutor")}
          />

          <button
            className="flex items-center gap-2 py-1.5 text-left text-caption font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onOpenSettings()}
            type="button"
          >
            <IconSettings className="size-3.5 shrink-0" />
            Manage settings
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
