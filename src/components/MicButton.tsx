import { IconMicrophone, IconMicrophoneFilled } from "@tabler/icons-react";
import type { PressOwner, RecordingState } from "../hooks/usePushToTalk";
import { InputGroupButton } from "./ui/input-group";
import { cn } from "../lib/utils";

type MicButtonProps = {
  disabled: boolean;
  disabledHint?: string;
  onEnd: (owner: PressOwner) => void;
  onStart: (owner: PressOwner) => void;
  speaking?: boolean;
  state: RecordingState;
  thinking?: boolean;
};

export function MicButton({
  disabled,
  disabledHint,
  onEnd,
  onStart,
  speaking = false,
  state,
  thinking = false,
}: MicButtonProps) {
  const isHeld = state.status === "requesting" || state.status === "recording";
  const isDisabled = disabled || state.status === "transcribing" || thinking || speaking;

  const label = speaking
    ? "Speaking…"
    : thinking
      ? "Thinking…"
      : state.status === "transcribing"
        ? "Transcribing…"
        : isDisabled
          ? "Microphone unavailable"
          : isHeld
            ? "Stop recording"
            : "Start recording";
  const hint = speaking
    ? "The tutor reply is playing"
    : thinking
      ? "The local tutor is preparing a reply"
      : state.status === "transcribing"
        ? "Processing your recording locally"
        : isDisabled
          ? (disabledHint ?? "Voice input is available when the conversation is ready")
          : isHeld
            ? "Click to stop and send"
            : "Click to start recording";

  return (
    <InputGroupButton
      aria-describedby="mic-button-hint"
      aria-label={label}
      aria-pressed={isHeld}
      className={cn(
        "size-8 rounded-full p-0",
        isHeld && "bg-destructive/10 text-destructive hover:bg-destructive/20",
      )}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) {
          return;
        }
        if (isHeld) {
          onEnd("pointer");
        } else {
          onStart("pointer");
        }
      }}
      size="icon-sm"
      type="button"
    >
      {isHeld ? (
        <IconMicrophoneFilled className={cn("size-4", "animate-pulse")} />
      ) : (
        <IconMicrophone className="size-4" />
      )}
      <span className="sr-only" id="mic-button-hint">
        {hint}
      </span>
    </InputGroupButton>
  );
}
