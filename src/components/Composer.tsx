import { useState } from "react";
import { IconSend } from "@tabler/icons-react";
import type { PressOwner, RecordingState } from "../hooks/usePushToTalk";
import type { TutorModel } from "../types/tutor";
import { MicButton } from "./MicButton";
import { ModelPicker } from "./ModelPicker";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group";

type ComposerProps = {
  currentModel?: string;
  disabled: boolean;
  disabledHint?: string;
  modelPickerDisabled?: boolean;
  models: TutorModel[];
  onRecordEnd: (owner: PressOwner) => void;
  onRecordStart: (owner: PressOwner) => void;
  onSelectModel: (modelName: string) => void;
  onSend: (text: string) => void;
  recordingState: RecordingState;
  speaking?: boolean;
  thinking?: boolean;
};

export function Composer({
  currentModel,
  disabled,
  disabledHint,
  modelPickerDisabled,
  models,
  onRecordEnd,
  onRecordStart,
  onSelectModel,
  onSend,
  recordingState,
  speaking,
  thinking,
}: ComposerProps) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue("");
  }

  return (
    <form
      aria-label="Typed message"
      className="shrink-0 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-describedby="composer-hint"
          aria-label="Type a message"
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Type a message…"
          rows={1}
          value={value}
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <ModelPicker
            currentModel={currentModel}
            disabled={modelPickerDisabled}
            models={models}
            onSelect={onSelectModel}
          />
          <div className="flex items-center gap-1">
            <MicButton
              disabled={disabled}
              disabledHint={disabledHint}
              onEnd={onRecordEnd}
              onStart={onRecordStart}
              speaking={speaking}
              state={recordingState}
              thinking={thinking}
            />
            <InputGroupButton
              aria-label="Send message"
              className="size-8 rounded-full p-0"
              disabled={disabled || !value.trim()}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <IconSend className="size-4" />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
      <span className="sr-only" id="composer-hint">
        {disabled
          ? (disabledHint ?? "Typing is available when the conversation is ready")
          : "Enter sends, Shift+Enter adds a new line"}
      </span>
    </form>
  );
}
