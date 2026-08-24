import type { RecordedAudio } from "../audio/recorder";
import type { RecordingState } from "../hooks/usePushToTalk";

type ConversationStageProps = {
  state: RecordingState;
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

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
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

function StageContent({ state }: ConversationStageProps) {
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

  if (state.status === "recorded") {
    return (
      <RecordingPlayback
        announce
        recording={state.recording}
        title="Recording ready"
      />
    );
  }

  if (state.status === "error") {
    return (
      <div className="recording-error" role="alert">
        <p className="recording-error__title">Microphone unavailable</p>
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
            title="Previous recording"
          />
        )}
      </div>
    );
  }

  return (
    <p className="conversation-stage__empty">
      Your conversation will appear here
    </p>
  );
}

export function ConversationStage({ state }: ConversationStageProps) {
  return (
    <section className="conversation-stage" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="visually-hidden">
        Conversation
      </h2>
      <span className="frame-mark frame-mark--top-left" aria-hidden="true" />
      <span className="frame-mark frame-mark--top-center" aria-hidden="true" />
      <span className="frame-mark frame-mark--top-right" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-left" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-center" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-right" aria-hidden="true" />
      <StageContent state={state} />
    </section>
  );
}
