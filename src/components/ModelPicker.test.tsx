import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TutorModel } from "../types/tutor";
import { ModelPicker } from "./ModelPicker";

afterEach(() => {
  cleanup();
});

const models: TutorModel[] = [
  { name: "qwen3.5:9b", parameterSize: "9B" },
  { name: "llama3.1:8b", parameterSize: "8B" },
];

describe("ModelPicker", () => {
  it("shows the current model on the trigger", () => {
    render(<ModelPicker currentModel="qwen3.5:9b" models={models} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Choose the tutor model" })).toHaveTextContent(
      "qwen3.5:9b",
    );
  });

  it("lists the models and calls onSelect with the clicked model's name", () => {
    const onSelect = vi.fn();
    render(<ModelPicker currentModel="qwen3.5:9b" models={models} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose the tutor model" }));
    fireEvent.click(screen.getByText(/llama3\.1:8b/));

    expect(onSelect).toHaveBeenCalledWith("llama3.1:8b");
  });

  it("marks the current model with a checkmark", () => {
    render(<ModelPicker currentModel="llama3.1:8b" models={models} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose the tutor model" }));

    const menu = screen.getByRole("menu");
    const activeItem = within(menu).getByText(/llama3\.1:8b/).closest('[role="menuitem"]');
    expect(activeItem?.querySelector("svg")).toBeInTheDocument();
    const otherItem = within(menu).getByText(/qwen3\.5:9b/).closest('[role="menuitem"]');
    expect(otherItem?.querySelector("svg")).not.toBeInTheDocument();
  });

  it("disables the trigger and shows a placeholder when there are no models", () => {
    render(<ModelPicker models={[]} onSelect={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Choose the tutor model" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("No models found at this URL");
  });
});
