import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import { TalkControl } from "../components/TalkControl";
import type { EvaluateRepairRequest, RepairEvaluation } from "../types/repair";
import type { SubmitReadingSpokenResponseRequest } from "../types/reading";
import { useReadingSpokenResponse } from "./useReadingSpokenResponse";

type SubmitSpokenResponseFn = (request: SubmitReadingSpokenResponseRequest) => Promise<void>;
type EvaluateRepairFn = (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;

function createRecording(): RecordedAudio {
  const blob = new Blob(["local audio"], { type: "audio/webm" });
  return {
    blob,
    playbackUrl: "blob:recording",
    durationMs: 1200,
    mimeType: "audio/webm",
    sizeBytes: blob.size,
  };
}

function createRecorder() {
  return {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<RecordedAudio>>().mockResolvedValue(createRecording()),
    cancel: vi.fn(),
    dispose: vi.fn(),
  } satisfies AudioRecorder;
}

function SpokenResponseHarness({
  attemptId = 10,
  recorder,
  transcribe = async () => ({ text: "I think the launch got pushed back." }),
  submitSpokenResponse = vi.fn<SubmitSpokenResponseFn>().mockResolvedValue(undefined),
  evaluateRepair = vi.fn<EvaluateRepairFn>().mockResolvedValue({ shouldIntervene: false }),
}: {
  attemptId?: number;
  recorder: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<{ text: string }>;
  submitSpokenResponse?: SubmitSpokenResponseFn;
  evaluateRepair?: EvaluateRepairFn;
}) {
  const spokenResponse = useReadingSpokenResponse({
    attemptId,
    enabled: true,
    recorder,
    transcribe,
    submitSpokenResponse,
    evaluateRepair,
  });

  return (
    <>
      <p data-testid="status">{spokenResponse.state.status}</p>
      {spokenResponse.state.status === "submitted" && (
        <>
          <p data-testid="transcript">{spokenResponse.state.transcript}</p>
          <p data-testid="repair">{spokenResponse.state.repair ? "has-repair" : "no-repair"}</p>
        </>
      )}
      {spokenResponse.state.status === "error" && (
        <p data-testid="error">{spokenResponse.state.error.message}</p>
      )}
      <p data-testid="pushToTalk-status">{spokenResponse.pushToTalk.state.status}</p>
      <TalkControl
        disabled={false}
        onEnd={spokenResponse.pushToTalk.end}
        onStart={spokenResponse.pushToTalk.begin}
        state={spokenResponse.pushToTalk.state}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useReadingSpokenResponse", () => {
  it("submits the transcript and evaluates repair once recording finishes", async () => {
    const recorder = createRecorder();
    const submitSpokenResponse = vi.fn<SubmitSpokenResponseFn>().mockResolvedValue(undefined);
    const evaluateRepair = vi
      .fn<EvaluateRepairFn>()
      .mockResolvedValue({ shouldIntervene: true, original: "got pushed", suggested: "was delayed" });

    render(
      <SpokenResponseHarness
        evaluateRepair={evaluateRepair}
        recorder={recorder}
        submitSpokenResponse={submitSpokenResponse}
      />,
    );
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.pointerDown(control, { button: 0, pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByTestId("pushToTalk-status")).toHaveTextContent("recording"),
    );
    fireEvent.pointerUp(control, { button: 0, pointerId: 1 });

    await screen.findByText("submitted");
    expect(submitSpokenResponse).toHaveBeenCalledWith({
      attemptId: 10,
      spokenResponseText: "I think the launch got pushed back.",
    });
    expect(evaluateRepair).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: "I think the launch got pushed back." }),
    );
    expect(screen.getByTestId("transcript")).toHaveTextContent(
      "I think the launch got pushed back.",
    );
    expect(screen.getByTestId("repair")).toHaveTextContent("has-repair");
  });

  it("still lands on submitted with no repair when repair evaluation fails", async () => {
    const recorder = createRecorder();
    const evaluateRepair = vi.fn<EvaluateRepairFn>().mockRejectedValue(new Error("offline"));

    render(<SpokenResponseHarness evaluateRepair={evaluateRepair} recorder={recorder} />);
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.pointerDown(control, { button: 0, pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByTestId("pushToTalk-status")).toHaveTextContent("recording"),
    );
    fireEvent.pointerUp(control, { button: 0, pointerId: 1 });

    await screen.findByText("submitted");
    expect(screen.getByTestId("repair")).toHaveTextContent("no-repair");
  });

  it("lands on error when persisting the transcript fails", async () => {
    const recorder = createRecorder();
    const submitSpokenResponse = vi.fn<SubmitSpokenResponseFn>().mockRejectedValue({
      code: "reading-task-failed",
      message: "The spoken response could not be saved.",
    });

    render(<SpokenResponseHarness recorder={recorder} submitSpokenResponse={submitSpokenResponse} />);
    const control = screen.getByRole("button", { name: /hold to talk/i });

    fireEvent.pointerDown(control, { button: 0, pointerId: 1 });
    await waitFor(() =>
      expect(screen.getByTestId("pushToTalk-status")).toHaveTextContent("recording"),
    );
    fireEvent.pointerUp(control, { button: 0, pointerId: 1 });

    await screen.findByText("error");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The spoken response could not be saved.",
    );
  });

  it("auto-stops the recording once it crosses the 60 second cap", async () => {
    vi.useFakeTimers();
    try {
      const recorder = createRecorder();
      render(<SpokenResponseHarness recorder={recorder} />);
      const control = screen.getByRole("button", { name: /hold to talk/i });

      await act(async () => {
        fireEvent.pointerDown(control, { button: 0, pointerId: 1 });
        await Promise.resolve();
      });

      expect(recorder.stop).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
      });

      expect(recorder.stop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
