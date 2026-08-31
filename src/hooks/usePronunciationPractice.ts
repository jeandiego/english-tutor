import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordedAudio } from "../audio/recorder";
import {
  PronunciationError,
  submitPronunciationAttempt,
  toPronunciationError,
} from "../native/pronunciation";
import type {
  PronunciationAttemptResult,
  SubmitPronunciationAttemptRequest,
} from "../types/pronunciation";
import { usePushToTalk } from "./usePushToTalk";

export type PronunciationPracticeState =
  | { status: "idle" }
  | { status: "submitting"; transcript: string }
  | { status: "result"; transcript: string; result: PronunciationAttemptResult }
  | { status: "error"; error: PronunciationError };

type UsePronunciationPracticeOptions = {
  enabled: boolean;
  submitAttempt?: (
    request: SubmitPronunciationAttemptRequest,
  ) => Promise<PronunciationAttemptResult>;
};

export function usePronunciationPractice({
  enabled,
  submitAttempt = submitPronunciationAttempt,
}: UsePronunciationPracticeOptions) {
  const [practiceState, setPracticeState] = useState<PronunciationPracticeState>({
    status: "idle",
  });
  const [attemptHistory, setAttemptHistory] = useState<PronunciationAttemptResult[]>([]);
  const pushToTalk = usePushToTalk({ enabled });

  const submitAttemptRef = useRef(submitAttempt);
  submitAttemptRef.current = submitAttempt;
  const targetIdRef = useRef<number | null>(null);
  const lastProcessedRecordingRef = useRef<RecordedAudio | null>(null);

  const practice = useCallback(async (targetId: number, transcript: string) => {
    setPracticeState({ status: "submitting", transcript });
    try {
      const result = await submitAttemptRef.current({
        pronunciationTargetId: targetId,
        transcript,
      });
      setPracticeState({ status: "result", transcript, result });
      setAttemptHistory((history) => [...history, result]);
    } catch (error) {
      setPracticeState({ status: "error", error: toPronunciationError(error) });
    }
  }, []);

  useEffect(() => {
    const state = pushToTalk.state;
    if (
      state.status === "transcribed" &&
      targetIdRef.current !== null &&
      state.recording !== lastProcessedRecordingRef.current
    ) {
      lastProcessedRecordingRef.current = state.recording;
      void practice(targetIdRef.current, state.text);
    }
  }, [pushToTalk.state, practice]);

  const selectTarget = useCallback((targetId: number) => {
    targetIdRef.current = targetId;
    lastProcessedRecordingRef.current = null;
    setAttemptHistory([]);
    setPracticeState({ status: "idle" });
  }, []);

  const reset = useCallback(() => {
    setPracticeState({ status: "idle" });
  }, []);

  return {
    attemptHistory,
    practiceState,
    pushToTalk,
    reset,
    selectTarget,
  };
}
