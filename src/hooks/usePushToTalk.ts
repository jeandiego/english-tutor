import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBrowserAudioRecorder,
  RecordingError,
  toRecordingError,
  type AudioRecorder,
  type RecordedAudio,
} from "../audio/recorder";
import {
  transcribeRecording,
  toTranscriptionError,
  TranscriptionError,
} from "../native/transcription";
import type { TranscriptionResult } from "../types/transcription";

export type PressOwner = "assistive" | "keyboard" | "pointer";

export type RecordingState =
  | { status: "idle"; recording: null }
  | { status: "requesting"; recording: RecordedAudio | null }
  | {
      status: "recording";
      elapsedMs: number;
      recording: RecordedAudio | null;
    }
  | { status: "transcribing"; recording: RecordedAudio }
  | { status: "transcribed"; recording: RecordedAudio; text: string }
  | {
      status: "error";
      error: RecordingError | TranscriptionError;
      recording: RecordedAudio | null;
    };

type UsePushToTalkOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isCancelledStart(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function usePushToTalk({
  enabled,
  recorder: providedRecorder,
  transcribe: providedTranscriber,
}: UsePushToTalkOptions) {
  const recorderRef = useRef<AudioRecorder | null>(null);

  if (!recorderRef.current) {
    recorderRef.current = providedRecorder ?? createBrowserAudioRecorder();
  }

  const [state, setState] = useState<RecordingState>({
    status: "idle",
    recording: null,
  });
  const settledStateRef = useRef<RecordingState>({
    status: "idle",
    recording: null,
  });
  const transcriberRef = useRef(providedTranscriber ?? transcribeRecording);
  const abortControllerRef = useRef<AbortController | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const ownerRef = useRef<PressOwner | null>(null);
  const phaseRef = useRef<RecordingState["status"]>("idle");
  const recordingRef = useRef<RecordedAudio | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const restorePreviousRecording = useCallback(() => {
    const settledState = settledStateRef.current;
    phaseRef.current = settledState.status;
    setState(settledState);
  }, []);

  const begin = useCallback(
    async (owner: PressOwner) => {
      if (
        !enabled ||
        ownerRef.current ||
        phaseRef.current === "requesting" ||
        phaseRef.current === "recording" ||
        phaseRef.current === "transcribing"
      ) {
        return;
      }

      const recorder = recorderRef.current;
      if (!recorder) {
        return;
      }

      ownerRef.current = owner;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      phaseRef.current = "requesting";
      setState({
        status: "requesting",
        recording: recordingRef.current,
      });

      try {
        await recorder.start(abortController.signal);

        if (
          !mountedRef.current ||
          abortController.signal.aborted ||
          ownerRef.current !== owner
        ) {
          recorder.cancel();

          if (mountedRef.current) {
            restorePreviousRecording();
          }
          return;
        }

        abortControllerRef.current = null;
        recordingStartedAtRef.current = performance.now();
        phaseRef.current = "recording";
        setState({
          status: "recording",
          elapsedMs: 0,
          recording: recordingRef.current,
        });

        elapsedTimerRef.current = window.setInterval(() => {
          const startedAt = recordingStartedAtRef.current;
          if (startedAt === null) {
            return;
          }

          setState((current) =>
            current.status === "recording"
              ? {
                  ...current,
                  elapsedMs: performance.now() - startedAt,
                }
              : current,
          );
        }, 100);
      } catch (error) {
        abortControllerRef.current = null;

        if (!mountedRef.current) {
          return;
        }

        if (abortController.signal.aborted || isCancelledStart(error)) {
          restorePreviousRecording();
          return;
        }

        ownerRef.current = null;
        phaseRef.current = "error";
        const errorState: RecordingState = {
          status: "error",
          error: toRecordingError(error),
          recording: recordingRef.current,
        };
        settledStateRef.current = errorState;
        setState(errorState);
      }
    },
    [enabled, restorePreviousRecording],
  );

  const end = useCallback(
    async (owner: PressOwner) => {
      if (ownerRef.current !== owner) {
        return;
      }

      ownerRef.current = null;

      if (phaseRef.current === "requesting") {
        abortControllerRef.current?.abort();
        return;
      }

      if (phaseRef.current !== "recording") {
        return;
      }

      clearElapsedTimer();
      recordingStartedAtRef.current = null;
      const recorder = recorderRef.current;

      if (!recorder) {
        return;
      }

      try {
        const nextRecording = await recorder.stop();

        if (!mountedRef.current) {
          recorder.dispose(nextRecording);
          return;
        }

        const previousRecording = recordingRef.current;
        recordingRef.current = nextRecording;
        phaseRef.current = "transcribing";
        setState({ status: "transcribing", recording: nextRecording });

        if (previousRecording) {
          recorder.dispose(previousRecording);
        }

        try {
          const result = await transcriberRef.current(nextRecording);

          if (!mountedRef.current) {
            return;
          }

          phaseRef.current = "transcribed";
          const transcribedState: RecordingState = {
            status: "transcribed",
            recording: nextRecording,
            text: result.text,
          };
          settledStateRef.current = transcribedState;
          setState(transcribedState);
        } catch (error) {
          if (!mountedRef.current) {
            return;
          }

          phaseRef.current = "error";
          const errorState: RecordingState = {
            status: "error",
            error: toTranscriptionError(error),
            recording: nextRecording,
          };
          settledStateRef.current = errorState;
          setState(errorState);
        }
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        phaseRef.current = "error";
        const errorState: RecordingState = {
          status: "error",
          error: toRecordingError(error),
          recording: recordingRef.current,
        };
        settledStateRef.current = errorState;
        setState(errorState);
      }
    },
    [clearElapsedTimer],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableTarget(event.target) ||
        !enabled ||
        (ownerRef.current && ownerRef.current !== "keyboard")
      ) {
        return;
      }

      event.preventDefault();
      void begin("keyboard");
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && ownerRef.current === "keyboard") {
        event.preventDefault();
        void end("keyboard");
      }
    };

    const stopForInterruption = () => {
      const owner = ownerRef.current;
      if (owner) {
        void end(owner);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopForInterruption();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopForInterruption);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopForInterruption);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [begin, enabled, end]);

  useEffect(() => {
    if (!enabled && ownerRef.current) {
      void end(ownerRef.current);
    }
  }, [enabled, end]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      clearElapsedTimer();
      recorderRef.current?.cancel();

      if (recordingRef.current) {
        recorderRef.current?.dispose(recordingRef.current);
      }
    };
  }, [clearElapsedTimer]);

  return { begin, end, state };
}
