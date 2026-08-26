import { useEffect, useRef, useState } from "react";
import type { RecordedAudio } from "../audio/recorder";
import type {
  ConversationExchange,
  ConversationLoopState,
  ReplayState,
} from "../hooks/useTutorConversation";
import type { RecordingState } from "../hooks/usePushToTalk";
import { TranscriptionError } from "../native/transcription";
import type { BetterExpression, TutorCorrection, TutorTurn } from "../types/tutor";

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
};

function ReplayIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.5 6.5A6 6 0 1 0 16.9 11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M15.5 3v3.9h-3.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2.5l1.4 3.9 3.9 1.4-3.9 1.4L10 13.1l-1.4-3.9-3.9-1.4 3.9-1.4L10 2.5z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

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
    <div className="recording-result" role={announce ? "status" : undefined}>
      <p className="recording-result__title">{title}</p>
      <audio
        aria-label={`Play ${title.toLowerCase()}`}
        controls
        preload="metadata"
        src={recording.playbackUrl}
      />
      <dl className="recording-metadata" aria-label="Recording details">
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(recording.durationMs)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{displayMimeType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatSize(recording.sizeBytes)}</dd>
        </div>
      </dl>
    </div>
  );
}

function StageContent({ loopState, state }: ConversationStageProps) {
  if (loopState === "speaking") {
    return (
      <div className="recording-status recording-status--processing" role="status">
        <span className="recording-status__mark" aria-hidden="true" />
        <p>Speaking</p>
        <span className="recording-status__time">Tutor reply only</span>
      </div>
    );
  }

  if (loopState === "thinking") {
    return (
      <div className="recording-status recording-status--processing" role="status">
        <span className="recording-status__mark" aria-hidden="true" />
        <p>Thinking</p>
        <span className="recording-status__time">Your transcript stays on this Mac</span>
      </div>
    );
  }

  if (state.status === "requesting") {
    return (
      <div className="recording-status" role="status">
        <span className="recording-status__mark" aria-hidden="true" />
        <p>Waiting for microphone access</p>
      </div>
    );
  }

  if (state.status === "recording") {
    return (
      <div className="recording-status recording-status--active" role="status">
        <span className="recording-status__mark" aria-hidden="true" />
        <p>Listening</p>
        <span className="recording-status__time" aria-hidden="true">
          {formatElapsedTime(state.elapsedMs)}
        </span>
      </div>
    );
  }

  if (state.status === "transcribing") {
    return (
      <div className="recording-status recording-status--processing" role="status">
        <span className="recording-status__mark" aria-hidden="true" />
        <p>Transcribing locally</p>
        <span className="recording-status__time">Your audio stays on this Mac</span>
      </div>
    );
  }

  if (state.status === "transcribed") {
    return (
      <article className="conversation-turn conversation-turn--user user-turn" aria-label="Your latest conversation turn">
        <p className="conversation-turn__speaker">You</p>
        <p className="conversation-turn__text" role="status">
          {state.text}
        </p>
        <RecordingPlayback
          recording={state.recording}
          title="Recorded audio"
        />
      </article>
    );
  }

  if (state.status === "error") {
    const isTranscriptionError = state.error instanceof TranscriptionError;
    return (
      <div className="recording-error" role="alert">
        <p className="recording-error__title">
          {isTranscriptionError
            ? "Transcription unavailable"
            : "Microphone unavailable"}
        </p>
        <p>{state.error.message}</p>
        {state.error.technicalMessage !== state.error.message && (
          <details>
            <summary>Technical details</summary>
            <code>{state.error.technicalMessage}</code>
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
    <div className="recording-status" role={loopState === "idle" ? "status" : undefined}>
      <span className="recording-status__mark" aria-hidden="true" />
      <p>{loopState === "idle" ? "Ready" : "Your conversation will appear here"}</p>
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
    <ul className="corrections" aria-label="Corrections for this turn">
      {corrections.map((correction, index) => (
        <li className="correction" key={index}>
          <span className="tip-chip">
            {capitalize(correction.category)} · {capitalize(correction.severity)}
          </span>
          <p className="correction__row">
            <span className="correction__row-label">You said</span>
            <span className="correction__quote">“{correction.original}”</span>
          </p>
          <p className="correction__row">
            <span className="correction__row-label">Better</span>
            <span className="correction__quote correction__quote--better">
              “{correction.correction}”
            </span>
          </p>
          <p className="correction__explanation">{correction.explanation}</p>
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
    <ul className="better-expressions" aria-label="Better ways to say this">
      {expressions.map((expression, index) => (
        <li className="better-expression" key={index}>
          {expression.original && (
            <p className="better-expression__row">
              <span className="better-expression__row-label">Instead of</span>
              <span className="better-expression__quote">“{expression.original}”</span>
            </p>
          )}
          <p className="better-expression__row">
            <span className="better-expression__row-label">Try</span>
            <span className="better-expression__quote better-expression__quote--better">
              “{expression.suggestion}”
            </span>
          </p>
          {expression.explanation && (
            <p className="better-expression__explanation">{expression.explanation}</p>
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
    <div className="tutor-coaching">
      <button
        aria-expanded={expanded}
        className="tutor-coaching__toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="tutor-coaching__toggle-label">
          <SparkleIcon className="tutor-coaching__toggle-icon" />
          {expanded ? "Hide" : "Show"} {count} tip{count > 1 ? "s" : ""}
        </span>
        <ChevronIcon
          className={
            expanded ? "tutor-coaching__chevron is-open" : "tutor-coaching__chevron"
          }
        />
      </button>
      {expanded && (
        <div className="tutor-coaching__body">
          <Corrections corrections={tutorTurn.corrections} />
          <BetterExpressions expressions={tutorTurn.betterExpressions} />
        </div>
      )}
    </div>
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
    <span className="replay">
      <button
        aria-label={isThisReplaying ? "Replaying tutor reply" : "Replay tutor reply"}
        className={
          isThisReplaying ? "replay-button replay-button--active" : "replay-button"
        }
        disabled={isDisabled}
        onClick={() => onReplay(exchangeId)}
        type="button"
      >
        <ReplayIcon className="replay-button__icon" />
        <span>{isThisReplaying ? "Replaying…" : "Replay"}</span>
      </button>
      {hasError && replayState?.error && (
        <span className="replay__error" role="alert">
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
    <p className="storage-warning" role="status">
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
    <div className="history-warning" role="status">
      <p>{message}</p>
      <button
        aria-label="Dismiss"
        className="history-warning__dismiss"
        onClick={() => setDismissed(true)}
        type="button"
      >
        Dismiss
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
    <div className="tutor-turn-error" role="alert">
      <p className="tutor-turn-error__title">{title}</p>
      <p>{exchange.error.message}</p>
      {exchange.error.technicalMessage !== exchange.error.message && (
        <details>
          <summary>Technical details</summary>
          <code>{exchange.error.technicalMessage}</code>
        </details>
      )}
    </div>
  );
}

function ConversationLog({
  exchanges,
  loopState,
  onReplay,
  replayState,
  showCoaching = true,
  speaking = false,
  thinking,
  state,
}: Required<Pick<ConversationStageProps, "exchanges" | "thinking">> &
  Pick<
    ConversationStageProps,
    "loopState" | "onReplay" | "replayState" | "showCoaching" | "speaking" | "state"
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
    <div className="conversation-log" role="log" aria-live="polite">
      {exchanges.map((exchange, index) => {
        const isLatest = index === exchanges.length - 1;
        const latestRecording =
          isLatest && state.status === "transcribed" ? state.recording : undefined;

        return (
          <article className="conversation-exchange" key={exchange.id}>
            {exchange.transcript && (
              <div className="conversation-turn conversation-turn--user">
                <p className="conversation-turn__speaker">You</p>
                <p className="conversation-turn__text">{exchange.transcript}</p>
                {latestRecording && (
                  <RecordingPlayback recording={latestRecording} title="Recorded audio" />
                )}
              </div>
            )}

            {exchange.tutorTurn && (
              <div className="conversation-turn conversation-turn--tutor">
                <p className="conversation-turn__speaker">Tutor</p>
                <div className="conversation-turn__body">
                  <p className="conversation-turn__text">
                    {exchange.tutorTurn.reply}
                  </p>
                  {(exchange.responseTimeMs !== undefined || onReplay) && (
                    <div className="conversation-turn__actions">
                      {exchange.responseTimeMs !== undefined && (
                        <p className="conversation-turn__meta">
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

            <StorageWarning message={exchange.storageWarning} />

            {isLatest && thinking && !exchange.tutorTurn && !exchange.error && (
              <div className="recording-status recording-status--processing tutor-thinking" role="status">
                <span className="recording-status__mark" aria-hidden="true" />
                <p>Thinking</p>
                <span className="recording-status__time">Your transcript stays on this Mac</span>
              </div>
            )}

            {isLatest && speaking && exchange.tutorTurn && !exchange.error && (
              <div className="recording-status recording-status--processing tutor-thinking" role="status">
                <span className="recording-status__mark" aria-hidden="true" />
                <p>Speaking</p>
                <span className="recording-status__time">Tutor reply only</span>
              </div>
            )}

            <TutorFailure exchange={exchange} />
          </article>
        );
      })}

      {showTransientState && (
        <div className="conversation-log__transient">
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
  replayState,
  showCoaching = true,
  speaking = false,
  state,
  exchanges = [],
  thinking = false,
  historyWarning,
}: ConversationStageProps) {
  return (
    <section className="conversation-stage" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="visually-hidden">
        Conversation
      </h2>
      <HistoryWarningBanner message={historyWarning} />
      {exchanges.length > 0 ? (
        <ConversationLog
          exchanges={exchanges}
          loopState={loopState}
          onReplay={onReplay}
          replayState={replayState}
          showCoaching={showCoaching}
          speaking={speaking}
          thinking={thinking}
          state={state}
        />
      ) : (
        <StageContent loopState={loopState} state={state} />
      )}
    </section>
  );
}
