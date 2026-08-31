import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { InputGroupButton } from "./ui/input-group";
import type { TutorModel } from "../types/tutor";

type ModelPickerProps = {
  currentModel?: string;
  disabled?: boolean;
  models: TutorModel[];
  onSelect: (modelName: string) => void;
};

export function ModelPicker({ currentModel, disabled, models, onSelect }: ModelPickerProps) {
  const isDisabled = disabled || models.length === 0;
  const triggerLabel =
    currentModel || (models.length > 0 ? "Choose a model" : "No models found at this URL");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isDisabled}
        render={
          <InputGroupButton
            aria-label="Choose the tutor model"
            className="max-w-40 justify-start"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <IconChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" side="top">
        {models.map((model) => (
          <DropdownMenuItem key={model.name} onClick={() => onSelect(model.name)}>
            <span className="min-w-0 flex-1 truncate">
              {model.name}
              {model.parameterSize ? ` — ${model.parameterSize}` : ""}
            </span>
            {model.name === currentModel && <IconCheck className="size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
