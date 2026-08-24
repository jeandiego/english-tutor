import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordingError,
  type AudioRecorder,
  type RecordedAudio,
} from "../audio/recorder";
import { ConversationStage } from "../components/ConversationStage";
import { TalkControl } from "../components/TalkControl";
import { usePushToTalk } from "./usePushToTalk";
import type { TranscriptionResult } from "../types/transcription";

function createRecording(playbackUrl = "blob:recording"): RecordedAudio {
  const blob = new Blob(["local audio"], { type: "audio/webm" });
  return {
    blob,
    playbackUrl,
    durationMs: 2400,
    mimeType: "audio/webm",
    sizeBytes: blob.size,
  };
}

function createRecorder() {
  return {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: vi
      .fn<() => Promise<RecordedAudio>>()
      .mockResolvedValue(createRecording()),
    cancel: vi.fn(),
    dispose: vi.fn(),
  } satisfies AudioRecorder;
}

function RecorderHarness({
  enabled = true,
  recorder,
  transcribe = async () => ({ text: "This is a local transcript." }),
}: {
  enabled?: boolean;
  recorder: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
}) {
  const recording = usePushToTalk({ enabled, recorder, transcribe });

  return (
    <>
      <label>
        Editable field
        <input />
      </label>
      <ConversationStage state={recording.state} />
      <TalkControl
        disabled={!enabled}
        disabledHint={!enabled ? "Complete local setup" : undefined}
        onEnd={(owner) => void recording.end(owner)}
        onStart={(owner) => void recording.begin(owner)}
        state={recording.state}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePushToTalk interactions", () => {
  it("records, transcribes, and exposes local playback metadata", async () => {
    const recorder = createRecorder();
    render(<RecorderHarness recorder={recorder} />);
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.pointerDown(control, { button: 0, pointerId: 1 });

    expect(await screen.findByText("Listening")).toBeInTheDocument();
    expect(recorder.start).toHaveBeenCalledOnce();

    fireEvent.pointerUp(control, { button: 0, pointerId: 1 });

    expect(await screen.findByText("This is a local transcript.")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByLabelText("Play recorded audio")).toHaveAttribute(
      "src",
      "blob:recording",
    );
    expect(screen.getByText("2.4 seconds")).toBeInTheDocument();
    expect(screen.getByText("audio/webm")).toBeInTheDocument();
    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it("records with Space, ignores repeats, and stops on keyup", async () => {
    const recorder = createRecorder();
    render(<RecorderHarness recorder={recorder} />);

    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    fireEvent.keyDown(window, { code: "Space", repeat: true });

    expect(recorder.start).toHaveBeenCalledOnce();

    fireEvent.keyUp(window, { code: "Space" });
    await screen.findByText("This is a local transcript.");

    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it("supports synthesized activation from assistive technology", async () => {
    const recorder = createRecorder();
    render(<RecorderHarness recorder={recorder} />);
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.click(control, { detail: 0 });
    await screen.findByText("Listening");

    expect(recorder.start).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", { name: /release to finish/i }),
      { detail: 0 },
    );
    await screen.findByText("This is a local transcript.");

    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it("does not capture Space from an editable field", () => {
    const recorder = createRecorder();
    render(<RecorderHarness recorder={recorder} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { code: "Space" });

    expect(recorder.start).not.toHaveBeenCalled();
  });

  it("stops an active keyboard recording when the window loses focus", async () => {
    const recorder = createRecorder();
    render(<RecorderHarness recorder={recorder} />);

    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    window.dispatchEvent(new Event("blur"));

    await waitFor(() => expect(recorder.stop).toHaveBeenCalledOnce());
  });

  it("cancels a permission request when the user releases early", async () => {
    const recorder = createRecorder();
    recorder.start.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        }),
    );
    render(<RecorderHarness recorder={recorder} />);
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.pointerDown(control, { button: 0, pointerId: 1 });
    await screen.findByText("Waiting for microphone access");
    fireEvent.pointerUp(control, { button: 0, pointerId: 1 });

    expect(
      await screen.findByText("Your conversation will appear here"),
    ).toBeInTheDocument();
    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it("shows actionable permission guidance", async () => {
    const recorder = createRecorder();
    recorder.start.mockRejectedValue(
      new RecordingError(
        "permission-denied",
        "Allow English Coach in System Settings and try again.",
        "NotAllowedError: Permission denied",
      ),
    );
    render(<RecorderHarness recorder={recorder} />);

    fireEvent.keyDown(window, { code: "Space" });

    expect(await screen.findByText("Microphone unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Allow English Coach in System Settings and try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
  });

  it("keeps the previous take after failure and disposes it after replacement", async () => {
    const recorder = createRecorder();
    const first = createRecording("blob:first");
    const second = createRecording("blob:second");
    recorder.stop.mockResolvedValueOnce(first);
    render(<RecorderHarness recorder={recorder} />);

    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    fireEvent.keyUp(window, { code: "Space" });
    await screen.findByText("This is a local transcript.");

    recorder.start.mockRejectedValueOnce(
      new RecordingError("device-busy", "Microphone busy.", "NotReadableError"),
    );
    fireEvent.keyDown(window, { code: "Space" });

    expect(await screen.findByText("Previous recording")).toBeInTheDocument();
    expect(screen.getByLabelText("Play previous recording")).toHaveAttribute(
      "src",
      "blob:first",
    );
    expect(recorder.dispose).not.toHaveBeenCalledWith(first);

    recorder.stop.mockResolvedValueOnce(second);
    fireEvent.keyUp(window, { code: "Space" });
    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    fireEvent.keyUp(window, { code: "Space" });
    await waitFor(() => expect(recorder.dispose).toHaveBeenCalledWith(first));
    expect(screen.getByLabelText("Play recorded audio")).toHaveAttribute(
      "src",
      "blob:second",
    );
  });

  it("shows a local processing state and blocks another recording", async () => {
    const recorder = createRecorder();
    let resolveTranscription:
      | ((result: TranscriptionResult) => void)
      | undefined;
    const transcribe = vi.fn(
      () =>
        new Promise<TranscriptionResult>((resolve) => {
          resolveTranscription = resolve;
        }),
    );
    render(<RecorderHarness recorder={recorder} transcribe={transcribe} />);

    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    fireEvent.keyUp(window, { code: "Space" });

    expect(await screen.findByText("Transcribing locally")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /transcribing/i })).toBeDisabled();
    fireEvent.keyDown(window, { code: "Space" });
    expect(recorder.start).toHaveBeenCalledOnce();

    resolveTranscription?.({ text: "Finished locally." });
    expect(await screen.findByText("Finished locally.")).toBeInTheDocument();
  });

  it("keeps failed audio and surfaces actionable transcription errors", async () => {
    const recorder = createRecorder();
    const transcribe = vi.fn().mockRejectedValue({
      code: "conversion-failed",
      message: "FFmpeg could not convert this recording.",
      technicalMessage: "Invalid input data",
    });
    render(<RecorderHarness recorder={recorder} transcribe={transcribe} />);

    fireEvent.keyDown(window, { code: "Space" });
    await screen.findByText("Listening");
    fireEvent.keyUp(window, { code: "Space" });

    expect(await screen.findByText("Transcription unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("FFmpeg could not convert this recording."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Play untranscribed audio")).toHaveAttribute(
      "src",
      "blob:recording",
    );
    expect(screen.getByText("Invalid input data")).toBeInTheDocument();
  });

  it("does not start while the desktop runtime is unavailable", () => {
    const recorder = createRecorder();
    render(<RecorderHarness enabled={false} recorder={recorder} />);

    fireEvent.keyDown(window, { code: "Space" });

    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeDisabled();
    expect(recorder.start).not.toHaveBeenCalled();
  });
});
