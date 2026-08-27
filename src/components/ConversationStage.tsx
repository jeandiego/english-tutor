import {
  IconChevronDown,
  IconCheck,
  IconRefresh,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { RecordedAudio } from "../audio/recorder";
import type {
  ConversationExchange,
  ConversationLoopState,
  ReplayState,
} from "../hooks/useTutorConversation";
import type { RecordingState } from "../hooks/usePushToTalk";
import { TranscriptionError } from "../native/transcription";
import type { ConversationRepairMeta, RepairOutcome, RepairPriority } from "../types/repair";
import type { BetterExpression, TutorCorrection, TutorTurn } from "../types/tutor";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";

type ConversationStageProps = {
  state: RecordingState;
  exchanges?: ConversationExchange[];
  loopState?: ConversationLoopState;
  speaking?: boolean;
  thinking?: boolean;
  historyWarning?: string;
  onReplay?: (exchangeId: number) => void;
  replayState?: ReplayState | null;
  showCoaching?: boolean;
  onSkipRepair?: () => void;
};

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(0.1, durationMs / 1000).toFixed(1)} seconds`;
  }

  const totalSeconds = durationMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0
    ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`
    : `${seconds.toFixed(1)} seconds`;
}

function formatElapsedTime(durationMs: number): string {
  const totalSeconds = durationMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function formatTutorResponseTime(durationMs: number): string {
  const totalSeconds = Math.max(0, durationMs) / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function formatTutorThroughput(tokensPerSecond: number): string {
  return tokensPerSecond.toFixed(1);
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function StatusRow({
  label,
  meta,
  pulse = true,
  role = "status",
}: {
  label: string;
  meta?: string;
  pulse?: boolean;
  role?: "status" | undefined;
}) {
  return (
    <div className="flex items-center gap-2 py-2" role={role}>
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full bg-muted-foreground", pulse && "animate-pulse")}
      />
      <p className="text-body text-foreground">{label}</p>
      {meta && (
        <span aria-hidden="true" className="text-caption text-muted-foreground">
          {meta}
        </span>
      )}
    </div>
  );
}

function RecordingPlayback({
  announce = false,
  recording,
  title,
}: {
  announce?: boolean;
  recording: RecordedAudio;
  title: string;
}) {
  const displayMimeType =
    recording.mimeType === "application/octet-stream"
      ? "Unknown format"
      : recording.mimeType;

  return (
    <div className="flex flex-col gap-2" role={announce ? "status" : undefined}>
      <p className="text-caption font-medium text-muted-foreground">{title}</p>
      <audio
        aria-label={`Play ${title.toLowerCase()}`}
        className="w-full"
        controls
        preload="metadata"
        src={recording.playbackUrl}
      />
      <dl aria-label="Recording details" className="flex gap-4 text-caption text-muted-foreground">
        <div className="flex gap-1">
          <dt>Duration</dt>
          <dd className="text-foreground">{formatDuration(recording.durationMs)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Format</dt>
          <dd className="text-foreground">{displayMimeType}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Size</dt>
          <dd className="text-foreground">{formatSize(recording.sizeBytes)}</dd>
        </div>
      </dl>
    </div>
  );
}

function StageContent({ loopState, state }: ConversationStageProps) {
  if (loopState === "speaking") {
    return <StatusRow label="Speaking" meta="Tutor reply only" />;
  }

  if (loopState === "thinking") {
    return <StatusRow label="Thinking" meta="Your transcript stays on this Mac" />;
  }

  if (state.status === "requesting") {
    return <StatusRow label="Waiting for microphone access" pulse={false} />;
  }

  if (state.status === "recording") {
    return (
      <div className="flex items-center gap-2 py-2" role="status">
        <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
        <p className="text-body text-foreground">Listening</p>
        <span aria-hidden="true" className="text-caption text-muted-foreground">
          {formatElapsedTime(state.elapsedMs)}
        </span>
      </div>
    );
  }

  if (state.status === "transcribing") {
    return <StatusRow label="Transcribing locally" meta="Your audio stays on this Mac" />;
  }

  if (state.status === "transcribed") {
    return (
      <article aria-label="Your latest conversation turn" className="flex flex-col gap-2">
        <p className="text-caption font-medium text-muted-foreground">You</p>
        <p className="text-body text-foreground" role="status">
          {state.text}
        </p>
        <RecordingPlayback recording={state.recording} title="Recorded audio" />
      </article>
    );
  }

  if (state.status === "error") {
    const isTranscriptionError = state.error instanceof TranscriptionError;
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-destructive/10 p-3" role="alert">
        <p className="text-body font-medium text-destructive">
          {isTranscriptionError ? "Transcription unavailable" : "Microphone unavailable"}
        </p>
        <p className="text-body text-destructive">{state.error.message}</p>
        {state.error.technicalMessage !== state.error.message && (
          <details className="text-caption text-destructive/80">
            <summary className="cursor-pointer">Technical details</summary>
            <code className="block whitespace-pre-wrap">{state.error.technicalMessage}</code>
          </details>
        )}
        {state.recording && (
          <RecordingPlayback
            recording={state.recording}
            title={isTranscriptionError ? "Untranscribed audio" : "Previous recording"}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2" role={loopState === "idle" ? "status" : undefined}>
      <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground" />
      <p className="text-body text-foreground">
        {loopState === "idle" ? "Ready" : "Your conversation will appear here"}
      </p>
    </div>
  );
}

export function ConversationStage(props: ConversationStageProps) {
  return <ConversationStageContent {...props} />;
}

function Corrections({ corrections }: { corrections: TutorCorrection[] }) {
  if (corrections.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Corrections for this turn" className="flex flex-col gap-3">
      {corrections.map((correction, index) => (
        <li className="flex flex-col gap-1.5 rounded-lg bg-accent p-3" key={index}>
          <Badge variant="outline">
            {capitalize(correction.category)} · {capitalize(correction.severity)}
          </Badge>
          <p className="text-body">
            <span className="text-muted-foreground">You said </span>
            <span className="text-foreground">“{correction.original}”</span>
          </p>
          <p className="text-body">
            <span className="text-muted-foreground">Better </span>
            <span className="font-medium text-success">“{correction.correction}”</span>
          </p>
          <p className="text-caption text-muted-foreground">{correction.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

function BetterExpressions({ expressions }: { expressions: BetterExpression[] }) {
  if (expressions.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Better ways to say this" className="flex flex-col gap-3">
      {expressions.map((expression, index) => (
        <li className="flex flex-col gap-1.5 rounded-lg bg-accent p-3" key={index}>
          {expression.original && (
            <p className="text-body">
              <span className="text-muted-foreground">Instead of </span>
              <span className="text-foreground">“{expression.original}”</span>
            </p>
          )}
          <p className="text-body">
            <span className="text-muted-foreground">Try </span>
            <span className="font-medium text-success">“{expression.suggestion}”</span>
          </p>
          {expression.explanation && (
            <p className="text-caption text-muted-foreground">{expression.explanation}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function TutorCoaching({ tutorTurn }: { tutorTurn: TutorTurn }) {
  const count = tutorTurn.corrections.length + tutorTurn.betterExpressions.length;
  const [expanded, setExpanded] = useState(true);

  if (count === 0) {
    return null;
  }

  return (
    <Collapsible data-testid="tutor-coaching" onOpenChange={setExpanded} open={expanded}>
      <CollapsibleTrigger
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-caption font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <IconSparkles className="size-3.5" />
          {expanded ? "Hide" : "Show"} {count} tip{count > 1 ? "s" : ""}
        </span>
        <IconChevronDown
          className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-3">
        <Corrections corrections={tutorTurn.corrections} />
        <BetterExpressions expressions={tutorTurn.betterExpressions} />
      </CollapsibleContent>
    </Collapsible>
  );
}

const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  coherence: "Coherence",
  pragmatics: "Pragmatics",
};

const REPAIR_OUTCOME_LABELS: Record<RepairOutcome, string> = {
  improved: "Fixed",
  failed: "Still tricky",
  skipped: "Skipped",
};

const REPAIR_OUTCOME_ICONS: Record<RepairOutcome, typeof IconCheck | undefined> = {
  improved: IconCheck,
  failed: undefined,
  skipped: undefined,
};

function RepairPrompt({
  disabled,
  onSkip,
  repair,
}: {
  disabled: boolean;
  onSkip?: () => void;
  repair: ConversationRepairMeta;
}) {
  return (
    <div className="flex items-center gap-2" role="status">
      <Badge variant="warning">
        {REPAIR_PRIORITY_LABELS[repair.priority]} · Your turn to try again
      </Badge>
      {onSkip && (
        <button
          className="text-caption font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={onSkip}
          type="button"
        >
          Skip
        </button>
      )}
    </div>
  );
}

function QuickCorrection({ repair }: { repair: ConversationRepairMeta }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-accent p-3">
      <Badge variant="outline">{REPAIR_PRIORITY_LABELS[repair.priority]} · Quick fix</Badge>
      <p className="text-body">
        <span className="text-foreground">“{repair.original}”</span>
        <span aria-hidden="true" className="text-muted-foreground">
          {" "}
          →{" "}
        </span>
        <span className="font-medium text-success">“{repair.suggested}”</span>
      </p>
      <p className="text-caption text-muted-foreground">{repair.microExplanation}</p>
    </div>
  );
}

function RepairOutcomeBadge({ outcome }: { outcome: RepairOutcome }) {
  const Icon = REPAIR_OUTCOME_ICONS[outcome];
  return (
    <Badge
      role="status"
      variant={outcome === "improved" ? "success" : outcome === "failed" ? "destructive" : "secondary"}
    >
      {Icon && <Icon data-icon="inline-start" />}
      {REPAIR_OUTCOME_LABELS[outcome]}
    </Badge>
  );
}

function ReplayButton({
  disabled,
  exchangeId,
  onReplay,
  replayState,
}: {
  disabled: boolean;
  exchangeId: number;
  onReplay: (exchangeId: number) => void;
  replayState?: ReplayState | null;
}) {
  const isThisReplaying =
    replayState?.exchangeId === exchangeId && replayState.status === "playing";
  const hasError =
    replayState?.exchangeId === exchangeId && replayState.status === "error";
  const otherReplaying =
    !!replayState &&
    replayState.exchangeId !== exchangeId &&
    replayState.status === "playing";
  const isDisabled = disabled || isThisReplaying || otherReplaying;

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        aria-label={isThisReplaying ? "Replaying tutor reply" : "Replay tutor reply"}
        disabled={isDisabled}
        onClick={() => onReplay(exchangeId)}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconRefresh className={cn(isThisReplaying && "animate-spin")} data-icon="inline-start" />
        {isThisReplaying ? "Replaying…" : "Replay"}
      </Button>
      {hasError && replayState?.error && (
        <span className="text-caption text-destructive" role="alert">
          {replayState.error.message}
        </span>
      )}
    </span>
  );
}

function StorageWarning({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p className="text-caption text-warning" role="status">
      {message}
    </p>
  );
}

function HistoryWarningBanner({ message }: { message?: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (!message || dismissed) {
    return null;
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg bg-warning/10 px-3 py-2"
      role="status"
    >
      <p className="text-body text-warning">{message}</p>
      <button
        aria-label="Dismiss"
        className="rounded-[4px] p-1 text-warning hover:bg-warning/20"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <IconX className="size-4" />
      </button>
    </div>
  );
}

function TutorFailure({ exchange }: { exchange: ConversationExchange }) {
  if (!exchange.error) {
    return null;
  }

  const title =
    exchange.errorSource === "speech" ? "Speech unavailable" : "Tutor unavailable";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-destructive/10 p-3" role="alert">
      <p className="text-body font-medium text-destructive">{title}</p>
      <p className="text-body text-destructive">{exchange.error.message}</p>
      {exchange.error.technicalMessage !== exchange.error.message && (
        <details className="text-caption text-destructive/80">
          <summary className="cursor-pointer">Technical details</summary>
          <code className="block whitespace-pre-wrap">{exchange.error.technicalMessage}</code>
        </details>
      )}
    </div>
  );
}

function ConversationLog({
  exchanges,
  loopState,
  onReplay,
  onSkipRepair,
  replayState,
  showCoaching = true,
  speaking = false,
  thinking,
  state,
}: Required<Pick<ConversationStageProps, "exchanges" | "thinking">> &
  Pick<
    ConversationStageProps,
    | "loopState"
    | "onReplay"
    | "onSkipRepair"
    | "replayState"
    | "showCoaching"
    | "speaking"
    | "state"
  >) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const showTransientState =
    state.status === "requesting" ||
    state.status === "recording" ||
    state.status === "transcribing" ||
    state.status === "error";

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [exchanges, speaking, thinking, state.status]);

  return (
    <div aria-live="polite" className="flex flex-1 flex-col gap-6 overflow-y-auto" role="log">
      {exchanges.map((exchange, index) => {
        const isLatest = index === exchanges.length - 1;
        const latestRecording =
          isLatest && state.status === "transcribed" ? state.recording : undefined;

        return (
          <article className="flex flex-col gap-3 border-b border-border pb-6 last:border-0" key={exchange.id}>
            {exchange.transcript && (
              <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-muted-foreground">You</p>
                <p className="text-body text-foreground">{exchange.transcript}</p>
                {latestRecording && (
                  <RecordingPlayback recording={latestRecording} title="Recorded audio" />
                )}
              </div>
            )}

            {exchange.tutorTurn && (
              <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-muted-foreground">Tutor</p>
                <div className="flex flex-col gap-2">
                  <p className="text-body text-foreground">{exchange.tutorTurn.reply}</p>
                  {(exchange.responseTimeMs !== undefined || onReplay) && (
                    <div className="flex flex-wrap items-center gap-3">
                      {exchange.responseTimeMs !== undefined && (
                        <p className="text-caption text-muted-foreground">
                          Responded in{" "}
                          <time dateTime={`PT${exchange.responseTimeMs / 1000}S`}>
                            {formatTutorResponseTime(exchange.responseTimeMs)}
                          </time>
                          {exchange.tutorTurn.performance && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span
                                aria-label={`${formatTutorThroughput(exchange.tutorTurn.performance.tokensPerSecond)} output tokens per second`}
                                title={`${exchange.tutorTurn.performance.outputTokens} output tokens generated by Ollama`}
                              >
                                {formatTutorThroughput(
                                  exchange.tutorTurn.performance.tokensPerSecond,
                                )}{" "}
                                tok/s
                              </span>
                            </>
                          )}
                        </p>
                      )}
                      {onReplay && (
                        <ReplayButton
                          disabled={thinking || speaking}
                          exchangeId={exchange.id}
                          onReplay={onReplay}
                          replayState={replayState}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {showCoaching && exchange.tutorTurn && (
              <TutorCoaching tutorTurn={exchange.tutorTurn} />
            )}

            {exchange.repair?.mode === "quick" && (
              <QuickCorrection repair={exchange.repair} />
            )}

            {exchange.repair?.mode === "repair" &&
              (exchange.repair.outcome ? (
                <RepairOutcomeBadge outcome={exchange.repair.outcome} />
              ) : (
                <RepairPrompt
                  disabled={thinking || speaking}
                  onSkip={onSkipRepair}
                  repair={exchange.repair}
                />
              ))}

            <StorageWarning message={exchange.storageWarning} />

            {isLatest && thinking && !exchange.tutorTurn && !exchange.error && (
              <StatusRow label="Thinking" meta="Your transcript stays on this Mac" />
            )}

            {isLatest && speaking && exchange.tutorTurn && !exchange.error && (
              <StatusRow label="Speaking" meta="Tutor reply only" />
            )}

            <TutorFailure exchange={exchange} />
          </article>
        );
      })}

      {showTransientState && (
        <div>
          <StageContent loopState={loopState} state={state} />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function ConversationStageContent({
  loopState,
  onReplay,
  onSkipRepair,
  replayState,
  showCoaching = true,
  speaking = false,
  state,
  exchanges = [],
  thinking = false,
  historyWarning,
}: ConversationStageProps) {
  return (
    <section
      aria-labelledby="conversation-title"
      className="flex flex-1 flex-col gap-4 overflow-hidden p-6"
    >
      <h2 className="sr-only" id="conversation-title">
        Conversation
      </h2>
      <HistoryWarningBanner message={historyWarning} />
      {exchanges.length > 0 ? (
        <Card className="flex flex-1 flex-col overflow-hidden">
          <CardContent className="flex flex-1 flex-col overflow-hidden pt-4">
            <ConversationLog
              exchanges={exchanges}
              loopState={loopState}
              onReplay={onReplay}
              onSkipRepair={onSkipRepair}
              replayState={replayState}
              showCoaching={showCoaching}
              speaking={speaking}
              thinking={thinking}
              state={state}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <StageContent loopState={loopState} state={state} />
        </div>
      )}
    </section>
  );
}
