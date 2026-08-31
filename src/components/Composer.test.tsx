import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingState } from "../hooks/usePushToTalk";
import type { TutorModel } from "../types/tutor";
import { Composer } from "./Composer";

afterEach(() => {
  cleanup();
});

const idleState: RecordingState = { status: "idle", recording: null };
const recordingState: RecordingState = { status: "recording", elapsedMs: 500, recording: null };

function baseProps() {
  return {
    disabled: false,
    models: [] as TutorModel[],
    onRecordEnd: vi.fn(),
    onRecordStart: vi.fn(),
    onSelectModel: vi.fn(),
    onSend: vi.fn(),
    recordingState: idleState,
  };
}

describe("Composer", () => {
  it("sends the trimmed text on Enter and clears the field", () => {
    const props = baseProps();
    render(<Composer {...props} />);

    const textarea = screen.getByLabelText("Type a message");
    fireEvent.change(textarea, { target: { value: "  Hello there  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(props.onSend).toHaveBeenCalledWith("Hello there");
    expect(textarea).toHaveValue("");
  });

  it("does not send on Shift+Enter, leaving the newline for the browser to insert", () => {
    const props = baseProps();
    render(<Composer {...props} />);

    const textarea = screen.getByLabelText("Type a message");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("sends when the send button is clicked", () => {
    const props = baseProps();
    render(<Composer {...props} />);

    const textarea = screen.getByLabelText("Type a message");
    fireEvent.change(textarea, { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(props.onSend).toHaveBeenCalledWith("Hello there");
  });

  it("does not send empty or whitespace-only text", () => {
    const props = baseProps();
    render(<Composer {...props} />);

    const textarea = screen.getByLabelText("Type a message");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(props.onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("disables the textarea and send button when disabled", () => {
    render(<Composer {...baseProps()} disabled={true} />);

    expect(screen.getByLabelText("Type a message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("starts recording when the mic button is clicked while idle", () => {
    const props = baseProps();
    render(<Composer {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

    expect(props.onRecordStart).toHaveBeenCalledWith("pointer");
    expect(props.onRecordEnd).not.toHaveBeenCalled();
  });

  it("stops recording when the mic button is clicked while recording", () => {
    const props = baseProps();
    render(<Composer {...props} recordingState={recordingState} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(props.onRecordEnd).toHaveBeenCalledWith("pointer");
    expect(props.onRecordStart).not.toHaveBeenCalled();
  });

  it("lists models in the picker and reports the selected one", () => {
    const props = baseProps();
    const models: TutorModel[] = [{ name: "qwen3.5:9b" }, { name: "llama3.1:8b" }];
    render(<Composer {...props} currentModel="qwen3.5:9b" models={models} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose the tutor model" }));
    fireEvent.click(screen.getByText("llama3.1:8b"));

    expect(props.onSelectModel).toHaveBeenCalledWith("llama3.1:8b");
  });
});
