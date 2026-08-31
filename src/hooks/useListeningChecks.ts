import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  generateComprehensionCheck as defaultGenerateComprehensionCheck,
  submitListeningCheckAttempt as defaultSubmitListeningCheckAttempt,
  toListeningError,
} from "../native/listening";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import { shouldTriggerCheck } from "../sessions/listeningPolicy";
import type {
  ComprehensionCheck,
  GenerateComprehensionCheckRequest,
  ListeningAccentFocus,
  ListeningCheckResult,
  SubmitListeningCheckAttemptRequest,
} from "../types/listening";
import type { TutorMessage } from "../types/tutor";
import type { ConversationExchange } from "./useTutorConversation";

export type ListeningCheckState =
  | { status: "idle" }
  | { status: "active"; check: ComprehensionCheck }
  | { status: "submitting"; check: ComprehensionCheck; answer: string }
  | { status: "result"; check: ComprehensionCheck; result: ListeningCheckResult }
  | { status: "error"; check: ComprehensionCheck; error: ReturnType<typeof toListeningError> };

type UseListeningChecksOptions = {
  enabled: boolean;
  exchanges: ConversationExchange[];
  sessionId?: number;
  accentFocus?: ListeningAccentFocus;
  stage: number;
  generateCheck?: (request: GenerateComprehensionCheckRequest) => Promise<ComprehensionCheck>;
  submitAttempt?: (
    request: SubmitListeningCheckAttemptRequest,
  ) => Promise<ListeningCheckResult>;
};

function isQualifyingExchange(exchange: ConversationExchange): boolean {
  return exchange.tutorTurn !== undefined && !exchange.repair && !exchange.review;
}

function recentHistoryFromExchanges(exchanges: ConversationExchange[]): TutorMessage[] {
  return exchanges.flatMap((exchange) =>
    exchange.tutorTurn
      ? [
          ...(exchange.transcript ? [{ role: "user" as const, content: exchange.transcript }] : []),
          { role: "assistant" as const, content: exchange.tutorTurn.reply },
        ]
      : [],
  );
}

/**
 * Independent of `useTutorConversation`'s push-to-talk state machine —
 * checks watch `exchanges` read-only and render their own answer UI, rather
 * than adding a fourth pending-state branch to that already-dense hook.
 */
export function useListeningChecks({
  enabled,
  exchanges,
  sessionId,
  accentFocus,
  stage,
  generateCheck = defaultGenerateComprehensionCheck,
  submitAttempt = defaultSubmitListeningCheckAttempt,
}: UseListeningChecksOptions) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ListeningCheckState>({ status: "idle" });
  const stateRef = useRef(state);
  const qualifyingTurnsRef = useRef(0);
  const lastProcessedExchangeIdRef = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  stateRef.current = state;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || stateRef.current.status !== "idle") {
      return;
    }

    const latest = exchanges[exchanges.length - 1];
    if (
      !latest ||
      latest.id === lastProcessedExchangeIdRef.current ||
      !isQualifyingExchange(latest)
    ) {
      return;
    }
    lastProcessedExchangeIdRef.current = latest.id;
    qualifyingTurnsRef.current += 1;

    if (!shouldTriggerCheck(qualifyingTurnsRef.current) || !latest.tutorTurn) {
      return;
    }

    const requestId = ++requestIdRef.current;
    void generateCheck({
      sessionId,
      tutorReply: latest.tutorTurn.reply,
      recentHistory: recentHistoryFromExchanges(exchanges.slice(0, -1)),
      accentFocus,
      stage,
    })
      .then((check) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return;
        }
        qualifyingTurnsRef.current = 0;
        setState({ status: "active", check });
      })
      .catch(() => {
        // A failed check generation shouldn't block the session — just skip
        // this opportunity and try again after the next interval.
      });
  }, [enabled, exchanges, sessionId, accentFocus, stage, generateCheck]);

  const submitAnswer = (answer: string) => {
    const current = stateRef.current;
    if (current.status !== "active") {
      return;
    }

    setState({ status: "submitting", check: current.check, answer });
    void submitAttempt({ checkId: current.check.id, answer })
      .then((result) => {
        if (!mountedRef.current) {
          return;
        }
        setState({ status: "result", check: current.check, result });
        void queryClient.invalidateQueries({ queryKey: learnerProfileKeys.detail() });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return;
        }
        setState({ status: "error", check: current.check, error: toListeningError(error) });
      });
  };

  const dismissResult = () => {
    if (stateRef.current.status === "result" || stateRef.current.status === "error") {
      setState({ status: "idle" });
    }
  };

  const skipCheck = () => {
    if (stateRef.current.status === "active") {
      setState({ status: "idle" });
    }
  };

  return { state, submitAnswer, skipCheck, dismissResult };
}
