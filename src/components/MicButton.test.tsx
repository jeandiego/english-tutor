import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingState } from "../hooks/usePushToTalk";
import { MicButton } from "./MicButton";

afterEach(() => {
  cleanup();
});

const idleState: RecordingState = { status: "idle", recording: null };
const recordingState: RecordingState = { status: "recording", elapsedMs: 1200, recording: null };
const transcribingState: RecordingState = {
  status: "transcribing",
  recording: { blob: new Blob(), playbackUrl: "blob:x", durationMs: 1, mimeType: "audio/webm", sizeBytes: 1 },
};

describe("MicButton", () => {
  it("starts recording on click when idle", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(<MicButton disabled={false} onEnd={onEnd} onStart={onStart} state={idleState} />);

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

    expect(onStart).toHaveBeenCalledWith("pointer");
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("stops recording on click when already recording", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(<MicButton disabled={false} onEnd={onEnd} onStart={onStart} state={recordingState} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(onEnd).toHaveBeenCalledWith("pointer");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("is disabled and does not start while transcribing, thinking, or speaking", () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <MicButton disabled={false} onEnd={vi.fn()} onStart={onStart} state={transcribingState} />,
    );
    expect(screen.getByRole("button", { name: "Transcribing…" })).toBeDisabled();

    rerender(
      <MicButton disabled={false} onEnd={vi.fn()} onStart={onStart} state={idleState} thinking />,
    );
    expect(screen.getByRole("button", { name: "Thinking…" })).toBeDisabled();

    rerender(
      <MicButton disabled={false} onEnd={vi.fn()} onStart={onStart} speaking state={idleState} />,
    );
    expect(screen.getByRole("button", { name: "Speaking…" })).toBeDisabled();

    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps a stable name and surfaces the disabled hint as a description", () => {
    render(
      <MicButton
        disabled
        disabledHint="Open Settings to complete local transcription setup"
        onEnd={vi.fn()}
        onStart={vi.fn()}
        state={idleState}
      />,
    );

    const button = screen.getByRole("button", { name: "Microphone unavailable" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Open Settings to complete local transcription setup")).toBeInTheDocument();
  });
});
