import { useState } from "react";
import { IconKeyboard, IconMicrophone, IconSend } from "@tabler/icons-react";
import type { PressOwner, RecordingState } from "../hooks/usePushToTalk";
import type { TutorModel } from "../types/tutor";
import { cn } from "../lib/utils";
import { TalkControl } from "./TalkControl";
import { Button } from "./ui/button";
import { Group, GroupSeparator, GroupText } from "./ui/group";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

type ConversationControlsProps = {
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

function shortModelLabel(modelName: string | null, models: TutorModel[]): string {
  if (!modelName) {
    return "Model";
  }
  const parameterSize = models.find((model) => model.name === modelName)?.parameterSize;
  return parameterSize ? parameterSize.toLowerCase() : modelName;
}

export function ConversationControls({
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
}: ConversationControlsProps) {
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [value, setValue] = useState("");
  const isTyping = mode === "type";

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue("");
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
      <Group aria-label="Model and reply mode">
        <Select
          disabled={modelPickerDisabled || models.length === 0}
          onValueChange={(modelName) => {
            if (modelName) {
              onSelectModel(modelName);
            }
          }}
          value={currentModel}
          
        >
          <SelectTrigger aria-label="Choose the tutor model" size="sm" className="rounded-tl-lg! rounded-bl-lg! border border-input bg-muted">
            <SelectValue placeholder={models.length > 0 ? "Model" : "No models found"} className="text-muted-foreground font-medium text-xs">
              {(value: string | null) => shortModelLabel(value, models)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="center" side="top" className="bg-muted text-muted-foreground p-2 w-full">
            {models.map((model) => (
              <SelectItem key={model.name} value={model.name} className="text-sm hover:bg-sidebar-ring/14!">
                {model.name}
                {model.parameterSize ? ` - ${model.parameterSize}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <GroupSeparator />
        <GroupText className="gap-1.5 py-1">
          <IconMicrophone
            aria-hidden="true"
            className={cn("size-3.5", !isTyping ? "text-foreground" : "text-muted-foreground")}
          />
          <Switch
            aria-label={isTyping ? "Switch to voice replies" : "Switch to typed replies"}
            checked={isTyping}
            onCheckedChange={(checked) => setMode(checked ? "type" : "voice")}
            size="sm"
          />
          <IconKeyboard
            aria-hidden="true"
            className={cn("size-3.5", isTyping ? "text-foreground" : "text-muted-foreground")}
          />
        </GroupText>
      </Group>

      {isTyping ? (
        <form
          aria-label="Typed message"
          className="flex w-full max-w-sm items-center gap-2 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            aria-label="Type a message"
            autoFocus
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Type a message…"
            value={value}
          />
          <Button
            aria-label="Send message"
            className="shrink-0 rounded-full"
            disabled={disabled || !value.trim()}
            size="icon"
            type="submit"
          >
            <IconSend className="size-4" />
          </Button>
        </form>
      ) : (
        <TalkControl
          disabled={disabled}
          disabledHint={disabledHint}
          onEnd={onRecordEnd}
          onStart={onRecordStart}
          speaking={speaking}
          state={recordingState}
          thinking={thinking}
        />
      )}
    </div>
  );
}
