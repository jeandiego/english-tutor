import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBrowserAudioRecorder,
  RecordingError,
  toRecordingError,
  type AudioRecorder,
  type RecordedAudio,
} from "../audio/recorder";

export type PressOwner = "assistive" | "keyboard" | "pointer";

export type RecordingState =
  | { status: "idle"; recording: null }
  | { status: "requesting"; recording: RecordedAudio | null }
  | {
      status: "recording";
      elapsedMs: number;
      recording: RecordedAudio | null;
    }
  | { status: "recorded"; recording: RecordedAudio }
  | {
      status: "error";
      error: RecordingError;
      recording: RecordedAudio | null;
    };

type UsePushToTalkOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
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
}: UsePushToTalkOptions) {
  const recorderRef = useRef<AudioRecorder | null>(null);

  if (!recorderRef.current) {
    recorderRef.current = providedRecorder ?? createBrowserAudioRecorder();
  }

  const [state, setState] = useState<RecordingState>({
    status: "idle",
    recording: null,
  });
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
    const previous = recordingRef.current;
    phaseRef.current = previous ? "recorded" : "idle";
    setState(
      previous
        ? { status: "recorded", recording: previous }
        : { status: "idle", recording: null },
    );
  }, []);

  const begin = useCallback(
    async (owner: PressOwner) => {
      if (
        !enabled ||
        ownerRef.current ||
        phaseRef.current === "requesting" ||
        phaseRef.current === "recording"
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
        setState({
          status: "error",
          error: toRecordingError(error),
          recording: recordingRef.current,
        });
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
        phaseRef.current = "recorded";
        setState({ status: "recorded", recording: nextRecording });

        if (previousRecording) {
          recorder.dispose(previousRecording);
        }
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        phaseRef.current = "error";
        setState({
          status: "error",
          error: toRecordingError(error),
          recording: recordingRef.current,
        });
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
