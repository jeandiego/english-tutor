import { useEffect, useRef, useState } from "react";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import {
  speakTutorReply,
  toSpeechError,
  type SpeechError,
} from "../native/speech";
import {
  requestTutorTurn,
  toTutorError,
  type TutorError,
} from "../native/tutor";
import type { TranscriptionResult } from "../types/transcription";
import type { TutorMessage, TutorTurn, TutorTurnRequest } from "../types/tutor";
import { usePushToTalk } from "./usePushToTalk";

const MAX_EXCHANGES = 12;

export type ConversationLoopState =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export type ConversationExchange = {
  id: number;
  transcript: string;
  tutorTurn?: TutorTurn;
  responseTimeMs?: number;
  error?: TutorError | SpeechError;
  errorSource?: "tutor" | "speech";
};

type UseTutorConversationOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
  respond?: (request: TutorTurnRequest) => Promise<TutorTurn>;
  speak?: (reply: string) => Promise<void>;
  now?: () => number;
};

const monotonicNow = () => performance.now();

function conversationHistory(
  exchanges: ConversationExchange[],
): TutorMessage[] {
  return exchanges.flatMap((exchange) =>
    exchange.tutorTurn
      ? [
          { role: "user" as const, content: exchange.transcript },
          { role: "assistant" as const, content: exchange.tutorTurn.reply },
        ]
      : [],
  );
}

export function useTutorConversation({
  enabled,
  recorder,
  transcribe,
  respond = requestTutorTurn,
  speak = speakTutorReply,
  now = monotonicNow,
}: UseTutorConversationOptions) {
  const [exchanges, setExchanges] = useState<ConversationExchange[]>([]);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const exchangesRef = useRef(exchanges);
  const mountedRef = useRef(true);
  const nextExchangeIdRef = useRef(1);
  const processedRecordingRef = useRef<RecordedAudio | null>(null);
  const requestIdRef = useRef(0);
  const respondRef = useRef(respond);
  const speakRef = useRef(speak);
  const nowRef = useRef(now);

  exchangesRef.current = exchanges;
  respondRef.current = respond;
  speakRef.current = speak;
  nowRef.current = now;

  const recording = usePushToTalk({
    enabled: enabled && !thinking && !speaking,
    recorder,
    transcribe,
  });
  const latestExchange = exchanges[exchanges.length - 1];

  const loopState: ConversationLoopState = speaking
    ? "speaking"
    : thinking
      ? "thinking"
      : recording.state.status === "requesting" ||
          recording.state.status === "recording"
        ? "recording"
        : recording.state.status === "transcribing"
          ? "transcribing"
          : recording.state.status === "error"
            ? "error"
            : latestExchange?.error
              ? "error"
              : "idle";

  useEffect(() => {
    if (
      recording.state.status !== "transcribed" ||
      processedRecordingRef.current === recording.state.recording
    ) {
      return;
    }

    processedRecordingRef.current = recording.state.recording;
    const exchangeId = nextExchangeIdRef.current++;
    const transcript = recording.state.text;
    const history = conversationHistory(exchangesRef.current).slice(
      -MAX_EXCHANGES * 2,
    );
    const requestId = ++requestIdRef.current;
    const readTime = nowRef.current;
    const responseStartedAt = readTime();

    setExchanges((current) => [
      ...current,
      { id: exchangeId, transcript },
    ]);
    setThinking(true);

    void respondRef
      .current({ transcript, history })
      .then(async (tutorTurn) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        const responseTimeMs = Math.max(0, readTime() - responseStartedAt);

        setExchanges((current) =>
          current
            .map((exchange) =>
              exchange.id === exchangeId
                ? { ...exchange, tutorTurn, responseTimeMs }
                : exchange,
            )
            .slice(-MAX_EXCHANGES),
        );
        setThinking(false);
        setSpeaking(true);

        try {
          await speakRef.current(tutorTurn.reply);

          if (!mountedRef.current || requestIdRef.current !== requestId) {
            return;
          }

          setSpeaking(false);
        } catch (error: unknown) {
          if (!mountedRef.current || requestIdRef.current !== requestId) {
            return;
          }

          setExchanges((current) =>
            current
              .map((exchange) =>
                exchange.id === exchangeId
                  ? {
                      ...exchange,
                      error: toSpeechError(error),
                      errorSource: "speech" as const,
                    }
                  : exchange,
              )
              .slice(-MAX_EXCHANGES),
          );
          setSpeaking(false);
        }
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setExchanges((current) =>
          current
            .map((exchange) =>
              exchange.id === exchangeId
                ? {
                    ...exchange,
                    error: toTutorError(error),
                    errorSource: "tutor" as const,
                  }
                : exchange,
            )
            .slice(-MAX_EXCHANGES),
        );
        setThinking(false);
      });
  }, [recording.state]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  return {
    ...recording,
    exchanges,
    thinking,
    speaking,
    loopState,
  };
}
