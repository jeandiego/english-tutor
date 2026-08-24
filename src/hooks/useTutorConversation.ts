import { useEffect, useRef, useState } from "react";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import {
  requestTutorTurn,
  toTutorError,
  type TutorError,
} from "../native/tutor";
import type { TranscriptionResult } from "../types/transcription";
import type { TutorMessage, TutorTurn, TutorTurnRequest } from "../types/tutor";
import { usePushToTalk } from "./usePushToTalk";

const MAX_EXCHANGES = 12;

export type ConversationExchange = {
  id: number;
  transcript: string;
  tutorTurn?: TutorTurn;
  responseTimeMs?: number;
  error?: TutorError;
};

type UseTutorConversationOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
  respond?: (request: TutorTurnRequest) => Promise<TutorTurn>;
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
  now = monotonicNow,
}: UseTutorConversationOptions) {
  const [exchanges, setExchanges] = useState<ConversationExchange[]>([]);
  const [thinking, setThinking] = useState(false);
  const exchangesRef = useRef(exchanges);
  const mountedRef = useRef(true);
  const nextExchangeIdRef = useRef(1);
  const processedRecordingRef = useRef<RecordedAudio | null>(null);
  const requestIdRef = useRef(0);
  const respondRef = useRef(respond);
  const nowRef = useRef(now);

  exchangesRef.current = exchanges;
  respondRef.current = respond;
  nowRef.current = now;

  const recording = usePushToTalk({
    enabled: enabled && !thinking,
    recorder,
    transcribe,
  });

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
      .then((tutorTurn) => {
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
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setExchanges((current) =>
          current
            .map((exchange) =>
              exchange.id === exchangeId
                ? { ...exchange, error: toTutorError(error) }
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
  };
}
