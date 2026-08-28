import { IconMicrophone, IconMicrophoneFilled } from "@tabler/icons-react";
import type { PressOwner, RecordingState } from "../hooks/usePushToTalk";
import { cn } from "../lib/utils";

type TalkControlProps = {
  disabled: boolean;
  disabledHint?: string;
  speaking?: boolean;
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
  speaking = false,
  thinking = false,
  onEnd,
  onStart,
  state,
}: TalkControlProps) {
  const isHeld = state.status === "requesting" || state.status === "recording";
  const isDisabled =
    disabled || state.status === "transcribing" || thinking || speaking;
  const label =
    speaking
      ? "Speaking…"
      : thinking
      ? "Thinking…"
      : state.status === "transcribing"
        ? "Transcribing…"
        : isHeld
          ? "Release"
          : "Hold to talk";
  let hint = "Hold the button or Space to speak";

  if (speaking) {
    hint = "The tutor reply is playing through macOS speech";
  } else if (thinking) {
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

  let secondary: string | null = null;
  if (state.status === "recording") {
    secondary = formatElapsedTime(state.elapsedMs);
  } else if (state.status === "requesting") {
    secondary = "Requesting…";
  } else if (!isDisabled) {
    secondary = "Space";
  }

  return (
    <section aria-label="Voice controls" className="flex shrink-0 justify-center px-4 pb-4 pt-1">
      <button
        aria-describedby="talk-control-hint"
        aria-label={label}
        aria-pressed={isHeld}
        className={cn(
          "group flex items-center gap-2 rounded-[var(--radius-inputs)] border border-transparent px-4 py-2 text-background transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          isHeld
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "bg-foreground hover:enabled:bg-foreground/90",
        )}
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
        {isHeld ? (
          <IconMicrophoneFilled className="size-[15px] shrink-0" />
        ) : (
          <IconMicrophone className="size-[15px] shrink-0" />
        )}
        <span className="text-[13px] font-medium">{label}</span>
        {secondary && (
          <span
            className={cn(
              "text-[11px]",
              isHeld
                ? "text-sidebar-accent-foreground/70"
                : "text-background/60 group-disabled:text-muted-foreground",
            )}
          >
            {secondary}
          </span>
        )}
        <span className="sr-only" id="talk-control-hint">
          {hint}
        </span>
      </button>
    </section>
  );
}