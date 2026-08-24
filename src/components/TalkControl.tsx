import type { PressOwner, RecordingState } from "../hooks/usePushToTalk";

type TalkControlProps = {
  disabled: boolean;
  disabledHint?: string;
  thinking?: boolean;
  onEnd: (owner: PressOwner) => void;
  onStart: (owner: PressOwner) => void;
  state: RecordingState;
};

function formatElapsedTime(durationMs: number): string {
  const totalSeconds = durationMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

export function TalkControl({
  disabled,
  disabledHint,
  thinking = false,
  onEnd,
  onStart,
  state,
}: TalkControlProps) {
  const isHeld = state.status === "requesting" || state.status === "recording";
  const isDisabled = disabled || state.status === "transcribing" || thinking;
  const label =
    thinking
      ? "Thinking…"
      : state.status === "recording"
      ? "Release to finish"
      : state.status === "transcribing"
        ? "Transcribing…"
        : "Hold to talk";
  let hint = "Hold the button or Space to speak";

  if (thinking) {
    hint = "The local tutor is preparing a reply";
  } else if (state.status === "transcribing") {
    hint = "Processing your recording locally";
  } else if (isDisabled) {
    hint =
      disabledHint ?? "Voice input is available when the desktop runtime is ready";
  } else if (state.status === "requesting") {
    hint = "Keep holding while macOS asks for microphone access";
  } else if (state.status === "recording") {
    hint = `${formatElapsedTime(state.elapsedMs)} elapsed`;
  } else if (state.status === "transcribed") {
    hint = "Hold the button or Space to record another take";
  } else if (state.status === "error") {
    hint = "Hold the button or Space to try again";
  }

  const finishPointerPress = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    onEnd("pointer");
  };

  return (
    <section className="talk-control-region" aria-label="Voice controls">
      <button
        aria-describedby="talk-control-hint"
        aria-label={label}
        aria-pressed={isHeld}
        className={`talk-control talk-control--${thinking ? "thinking" : state.status}`}
        disabled={isDisabled}
        onClick={(event) => {
          event.preventDefault();

          if (event.detail === 0) {
            if (isHeld) {
              onEnd("assistive");
            } else {
              onStart("assistive");
            }
          }
        }}
        onLostPointerCapture={() => onEnd("pointer")}
        onPointerCancel={finishPointerPress}
        onPointerDown={(event) => {
          if (isDisabled || event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onStart("pointer");
        }}
        onPointerUp={finishPointerPress}
        type="button"
      >
        <span className="talk-control__label">{label}</span>
        <span className="talk-control__hint" id="talk-control-hint">
          {hint}
        </span>
      </button>
    </section>
  );
}
