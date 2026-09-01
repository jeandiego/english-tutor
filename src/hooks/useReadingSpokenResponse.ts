import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import {
  ReadingError,
  submitReadingSpokenResponse as defaultSubmitReadingSpokenResponse,
  toReadingError,
} from "../native/reading";
import {
  evaluateRepairOpportunity as defaultEvaluateRepairOpportunity,
  RepairError,
} from "../native/repair";
import type { EvaluateRepairRequest, RepairEvaluation, RepairIntensity } from "../types/repair";
import type { SubmitReadingSpokenResponseRequest } from "../types/reading";
import type { TranscriptionResult } from "../types/transcription";
import { usePushToTalk, type PressOwner } from "./usePushToTalk";

const MAX_RECORDING_MS = 60_000;

export type ReadingSpokenResponseState =
  | { status: "idle" }
  | { status: "submitting"; transcript: string }
  | { status: "submitted"; transcript: string; repair?: RepairEvaluation }
  | { status: "error"; error: ReadingError | RepairError };

type UseReadingSpokenResponseOptions = {
  attemptId: number | undefined;
  enabled: boolean;
  repairIntensity?: RepairIntensity;
  submitSpokenResponse?: (request: SubmitReadingSpokenResponseRequest) => Promise<void>;
  evaluateRepair?: (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
};

/**
 * Composes push-to-talk recording with persistence and a transient repair
 * check for the Reading-to-Writing spoken response step. Mirrors
 * `usePronunciationPractice`'s record -> transcribe -> react composition.
 *
 * Repair feedback here is transient by design — it calls
 * `evaluateRepairOpportunity` and surfaces the result, but never persists a
 * `repair_event` row (that table's `turn_id` is a NOT NULL FK into `turn`,
 * which reading sessions don't have).
 */
export function useReadingSpokenResponse({
  attemptId,
  enabled,
  repairIntensity = "balanced",
  submitSpokenResponse = defaultSubmitReadingSpokenResponse,
  evaluateRepair = defaultEvaluateRepairOpportunity,
  recorder,
  transcribe,
}: UseReadingSpokenResponseOptions) {
  const [state, setState] = useState<ReadingSpokenResponseState>({ status: "idle" });
  const pushToTalk = usePushToTalk({ enabled: enabled && attemptId !== undefined, recorder, transcribe });

  const submitSpokenResponseRef = useRef(submitSpokenResponse);
  submitSpokenResponseRef.current = submitSpokenResponse;
  const evaluateRepairRef = useRef(evaluateRepair);
  evaluateRepairRef.current = evaluateRepair;
  const recordingOwnerRef = useRef<PressOwner | null>(null);
  const lastProcessedRecordingRef = useRef<RecordedAudio | null>(null);

  const begin = useCallback(
    (owner: PressOwner) => {
      recordingOwnerRef.current = owner;
      void pushToTalk.begin(owner);
    },
    [pushToTalk],
  );

  const end = useCallback(
    (owner: PressOwner) => {
      void pushToTalk.end(owner);
    },
    [pushToTalk],
  );

  // usePushToTalk has no built-in recording cap — enforce the 60s limit here.
  useEffect(() => {
    if (
      pushToTalk.state.status === "recording" &&
      pushToTalk.state.elapsedMs >= MAX_RECORDING_MS &&
      recordingOwnerRef.current
    ) {
      void pushToTalk.end(recordingOwnerRef.current);
    }
  }, [pushToTalk, pushToTalk.state]);

  const submit = useCallback(
    async (transcript: string) => {
      if (attemptId === undefined) {
        return;
      }
      setState({ status: "submitting", transcript });
      try {
        await submitSpokenResponseRef.current({ attemptId, spokenResponseText: transcript });
        let repair: RepairEvaluation | undefined;
        try {
          repair = await evaluateRepairRef.current({
            transcript,
            history: [],
            intensity: repairIntensity,
          });
        } catch {
          // Repair feedback is transient/best-effort — a failure here must
          // not hide that the transcript was already persisted above.
        }
        setState({ status: "submitted", transcript, repair });
      } catch (error) {
        setState({ status: "error", error: toReadingError(error) });
      }
    },
    [attemptId, repairIntensity],
  );

  useEffect(() => {
    const pushToTalkState = pushToTalk.state;
    if (
      pushToTalkState.status === "transcribed" &&
      pushToTalkState.recording !== lastProcessedRecordingRef.current
    ) {
      lastProcessedRecordingRef.current = pushToTalkState.recording;
      void submit(pushToTalkState.text);
    }
  }, [pushToTalk.state, submit]);

  return {
    pushToTalk: { begin, end, state: pushToTalk.state },
    state,
  };
}
