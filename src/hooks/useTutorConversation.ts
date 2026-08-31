import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import { historyKeys } from "../queryKeys/history";
import {
  evaluateRepairOpportunity,
  recordRepairEvent as nativeRecordRepairEvent,
  updateRepairEventOutcome as nativeUpdateRepairEventOutcome,
} from "../native/repair";
import {
  evaluateReviewAttempt as nativeEvaluateReviewAttempt,
  recordReviewOutcome as nativeRecordReviewOutcome,
} from "../native/review";
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
import { COOLDOWN_TURNS, selectRepairMode, severityTier } from "../sessions/repairPolicy";
import type {
  ConversationRepairMeta,
  EvaluateRepairRequest,
  RecordRepairEventRequest,
  RepairEvaluation,
  RepairIntensity,
  RepairOutcome,
  UpdateRepairEventOutcomeRequest,
} from "../types/repair";
import type {
  ConversationReviewMeta,
  EvaluateReviewAttemptRequest,
  RecordReviewOutcomeRequest,
  ReviewAttemptEvaluation,
  ReviewItem,
  ReviewItemType,
} from "../types/review";
import type { TranscriptionResult } from "../types/transcription";
import type { TutorMessage, TutorTurn, TutorTurnRequest } from "../types/tutor";
import { usePushToTalk } from "./usePushToTalk";

const REVIEW_PROMPT_LINES: Record<ReviewItemType, (content: string) => string> = {
  grammar_pattern: (content) => `Quick check — can you use "${content}" correctly in a sentence?`,
  vocabulary: (content) => `Quick check — can you use "${content}" in a sentence?`,
  phrase: (content) => `Quick check — try using the phrase "${content}" in your next answer.`,
  pronunciation_target: (content) => `Quick check — try saying "${content}" out loud in your answer.`,
  conversation_strategy: (content) => `Quick check — try "${content}" in your next answer.`,
};

function buildReviewPromptLine(item: ReviewItem): string {
  return REVIEW_PROMPT_LINES[item.type](item.content);
}

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
  storageWarning?: string;
  repair?: ConversationRepairMeta;
  review?: ConversationReviewMeta;
};

export type ReplayState = {
  exchangeId: number;
  status: "playing" | "error";
  error?: SpeechError;
};

type PendingRepairState = {
  exchangeId: number;
  eventId?: number;
  event: ConversationRepairMeta;
};

type PendingReviewState = {
  exchangeId: number;
  item: ReviewItem;
};

type UseTutorConversationOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
  respond?: (request: TutorTurnRequest) => Promise<TutorTurn>;
  speak?: (reply: string) => Promise<void>;
  now?: () => number;
  sessionId?: number;
  learnerContext?: string;
  seedMessages?: TutorMessage[];
  openingReply?: string;
  repairIntensity?: RepairIntensity;
  evaluateRepair?: (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;
  recordRepairEvent?: (request: RecordRepairEventRequest) => Promise<number>;
  updateRepairEventOutcome?: (request: UpdateRepairEventOutcomeRequest) => Promise<void>;
  dueReviewItems?: ReviewItem[];
  evaluateReviewAttempt?: (
    request: EvaluateReviewAttemptRequest,
  ) => Promise<ReviewAttemptEvaluation>;
  recordReviewOutcome?: (request: RecordReviewOutcomeRequest) => Promise<void>;
};

const monotonicNow = () => performance.now();

function conversationHistory(
  exchanges: ConversationExchange[],
): TutorMessage[] {
  return exchanges.flatMap((exchange) =>
    exchange.tutorTurn
      ? [
          ...(exchange.transcript
            ? [{ role: "user" as const, content: exchange.transcript }]
            : []),
          { role: "assistant" as const, content: exchange.tutorTurn.reply },
        ]
      : [],
  );
}

function seedExchangesFromMessages(
  messages: TutorMessage[],
  nextId: () => number,
): ConversationExchange[] {
  const seeded: ConversationExchange[] = [];
  for (let index = 0; index + 1 < messages.length; index += 2) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];
    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
      continue;
    }
    seeded.push({
      id: nextId(),
      transcript: userMessage.content,
      tutorTurn: { reply: assistantMessage.content, corrections: [], betterExpressions: [] },
    });
  }
  return seeded;
}

export function useTutorConversation({
  enabled,
  recorder,
  transcribe,
  respond = requestTutorTurn,
  speak = speakTutorReply,
  now = monotonicNow,
  sessionId,
  learnerContext,
  seedMessages,
  openingReply,
  repairIntensity = "balanced",
  evaluateRepair = evaluateRepairOpportunity,
  recordRepairEvent = nativeRecordRepairEvent,
  updateRepairEventOutcome = nativeUpdateRepairEventOutcome,
  dueReviewItems,
  evaluateReviewAttempt = nativeEvaluateReviewAttempt,
  recordReviewOutcome = nativeRecordReviewOutcome,
}: UseTutorConversationOptions) {
  const queryClient = useQueryClient();
  const [exchanges, setExchanges] = useState<ConversationExchange[]>([]);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const [pendingRepair, setPendingRepair] = useState<PendingRepairState | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReviewState | null>(null);
  const [liveTurnCount, setLiveTurnCount] = useState(0);
  const exchangesRef = useRef(exchanges);
  const mountedRef = useRef(true);
  const nextExchangeIdRef = useRef(1);
  const openingSeededRef = useRef(false);
  const processedRecordingRef = useRef<RecordedAudio | null>(null);
  const requestIdRef = useRef(0);
  const replayRequestIdRef = useRef(0);
  const respondRef = useRef(respond);
  const speakRef = useRef(speak);
  const nowRef = useRef(now);
  const sessionIdRef = useRef(sessionId);
  const previousSessionIdRef = useRef(sessionId);
  const learnerContextRef = useRef(learnerContext);
  const seedMessagesRef = useRef(seedMessages);
  const repairIntensityRef = useRef(repairIntensity);
  const evaluateRepairRef = useRef(evaluateRepair);
  const recordRepairEventRef = useRef(recordRepairEvent);
  const updateRepairEventOutcomeRef = useRef(updateRepairEventOutcome);
  const pendingRepairRef = useRef<PendingRepairState | null>(null);
  const turnsSinceInterventionRef = useRef(Number.POSITIVE_INFINITY);
  const seenIssueKeysRef = useRef<Set<string>>(new Set());
  const dueReviewItemsRef = useRef(dueReviewItems);
  const evaluateReviewAttemptRef = useRef(evaluateReviewAttempt);
  const recordReviewOutcomeRef = useRef(recordReviewOutcome);
  const pendingReviewRef = useRef<PendingReviewState | null>(null);
  const firstLearnerTurnRef = useRef(true);

  exchangesRef.current = exchanges;
  respondRef.current = respond;
  speakRef.current = speak;
  nowRef.current = now;
  sessionIdRef.current = sessionId;
  learnerContextRef.current = learnerContext;
  seedMessagesRef.current = seedMessages;
  repairIntensityRef.current = repairIntensity;
  evaluateRepairRef.current = evaluateRepair;
  recordRepairEventRef.current = recordRepairEvent;
  updateRepairEventOutcomeRef.current = updateRepairEventOutcome;
  dueReviewItemsRef.current = dueReviewItems;
  evaluateReviewAttemptRef.current = evaluateReviewAttempt;
  recordReviewOutcomeRef.current = recordReviewOutcome;

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
    if (!openingReply || openingSeededRef.current) {
      return;
    }
    openingSeededRef.current = true;
    const exchangeId = nextExchangeIdRef.current++;
    setExchanges((current) =>
      current.length === 0
        ? [
            {
              id: exchangeId,
              transcript: "",
              tutorTurn: { reply: openingReply, corrections: [], betterExpressions: [] },
            },
          ]
        : current,
    );
  }, [openingReply]);

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
    const isFirstLearnerTurn = firstLearnerTurnRef.current;
    firstLearnerTurnRef.current = false;
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
    setLiveTurnCount((count) => count + 1);
    setThinking(true);

    void respondRef
      .current({
        transcript,
        history,
        sessionId: sessionIdRef.current,
        learnerContext: learnerContextRef.current,
      })
      .then(async (tutorTurn) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        const responseTimeMs = Math.max(0, readTime() - responseStartedAt);
        const pending = pendingRepairRef.current;
        const pendingReviewAttempt = pendingReviewRef.current;
        let effectiveTurn = tutorTurn;
        let repairMeta: ConversationRepairMeta | undefined;
        let reviewMeta: ConversationReviewMeta | undefined;

        if (pendingReviewAttempt) {
          // This turn is the learner's attempt at the surfaced review item:
          // judge it instead of running repair detection on the same turn —
          // review and repair are mutually exclusive per turn, same
          // principle as repair's own no-chaining rule.
          let outcome: ReviewAttemptEvaluation["outcome"] = "missed";
          try {
            const evaluation = await evaluateReviewAttemptRef.current({
              itemType: pendingReviewAttempt.item.type,
              content: pendingReviewAttempt.item.content,
              transcript,
              history,
            });
            outcome = evaluation.outcome;
          } catch {
            outcome = "missed";
          }

          if (!mountedRef.current || requestIdRef.current !== requestId) {
            return;
          }

          void recordReviewOutcomeRef
            .current({
              reviewItemId: pendingReviewAttempt.item.id,
              outcome,
              sessionId: sessionIdRef.current,
            })
            .catch(() => {});
          pendingReviewRef.current = null;
          setPendingReview(null);
          setExchanges((current) =>
            current.map((exchange) =>
              exchange.id === pendingReviewAttempt.exchangeId && exchange.review
                ? { ...exchange, review: { ...exchange.review, outcome } }
                : exchange,
            ),
          );
          // effectiveTurn stays the naturally-generated tutorTurn — its own
          // continuation is the tutor's reaction to the attempt.
        } else if (pending) {
          // This turn is the learner's repair attempt: judge whether it
          // resolves the pending issue instead of running fresh detection —
          // repair-on-repair chaining is deliberately unsupported so a
          // retry can never itself trigger another blocking intervention.
          let outcome: RepairOutcome = "failed";
          try {
            const evaluation = await evaluateRepairRef.current({
              transcript,
              history,
              learnerContext: learnerContextRef.current,
              intensity: repairIntensityRef.current,
              pendingRepair: {
                priority: pending.event.priority,
                issue: pending.event.issue,
                original: pending.event.original,
                suggested: pending.event.suggested,
              },
            });
            outcome = evaluation.repairOutcome ?? "failed";
          } catch {
            outcome = "failed";
          }

          if (!mountedRef.current || requestIdRef.current !== requestId) {
            return;
          }

          if (pending.eventId !== undefined) {
            void updateRepairEventOutcomeRef
              .current({ eventId: pending.eventId, outcome })
              .catch(() => {});
          }
          pendingRepairRef.current = null;
          setPendingRepair(null);
          setExchanges((current) =>
            current.map((exchange) =>
              exchange.id === pending.exchangeId && exchange.repair
                ? { ...exchange, repair: { ...exchange.repair, outcome } }
                : exchange,
            ),
          );
          // effectiveTurn stays the naturally-generated tutorTurn — its own
          // continuation is the tutor "recognizing the improvement."
        } else if (
          isFirstLearnerTurn &&
          dueReviewItemsRef.current &&
          dueReviewItemsRef.current.length > 0
        ) {
          // Surface at most one due review item per session, on the
          // learner's first substantive turn — folded into the live
          // conversation rather than a separate quiz step.
          const item = dueReviewItemsRef.current[0];
          effectiveTurn = {
            reply: buildReviewPromptLine(item),
            corrections: [],
            betterExpressions: [],
          };
          reviewMeta = { reviewItemId: item.id, itemType: item.type, content: item.content };
          const nextPendingReview: PendingReviewState = { exchangeId, item };
          pendingReviewRef.current = nextPendingReview;
          setPendingReview(nextPendingReview);
        } else {
          let evaluation: RepairEvaluation | undefined;
          try {
            evaluation = await evaluateRepairRef.current({
              transcript,
              history,
              learnerContext: learnerContextRef.current,
              intensity: repairIntensityRef.current,
            });
          } catch {
            evaluation = undefined;
          }

          if (!mountedRef.current || requestIdRef.current !== requestId) {
            return;
          }

          if (
            evaluation?.shouldIntervene &&
            evaluation.priority &&
            evaluation.issue &&
            evaluation.original &&
            evaluation.suggested &&
            evaluation.microExplanation &&
            evaluation.repairPrompt
          ) {
            const issueKey = `${evaluation.priority}:${evaluation.issue}`;
            const isRecurring = seenIssueKeysRef.current.has(issueKey);
            seenIssueKeysRef.current.add(issueKey);

            const tier = severityTier(evaluation.priority, isRecurring);
            const cooldownOk =
              turnsSinceInterventionRef.current >= COOLDOWN_TURNS[repairIntensityRef.current];
            const mode = selectRepairMode(repairIntensityRef.current, tier, cooldownOk);
            turnsSinceInterventionRef.current = mode === "implicit" ? turnsSinceInterventionRef.current + 1 : 0;

            const meta: ConversationRepairMeta = {
              priority: evaluation.priority,
              issue: evaluation.issue,
              original: evaluation.original,
              suggested: evaluation.suggested,
              microExplanation: evaluation.microExplanation,
              repairPrompt: evaluation.repairPrompt,
              mode,
            };

            let eventId: number | undefined;
            if (tutorTurn.turnId !== undefined) {
              try {
                eventId = await recordRepairEventRef.current({
                  turnId: tutorTurn.turnId,
                  priority: evaluation.priority,
                  issue: evaluation.issue,
                  original: evaluation.original,
                  suggested: evaluation.suggested,
                  microExplanation: evaluation.microExplanation,
                  repairPrompt: evaluation.repairPrompt,
                  mode,
                  intensity: repairIntensityRef.current,
                });
              } catch {
                eventId = undefined;
              }
            }

            if (!mountedRef.current || requestIdRef.current !== requestId) {
              return;
            }

            repairMeta = { ...meta, eventId };

            if (mode === "repair") {
              effectiveTurn = {
                reply: `${evaluation.microExplanation} ${evaluation.repairPrompt}`.trim(),
                corrections: [],
                betterExpressions: [],
              };
              const nextPending: PendingRepairState = {
                exchangeId,
                eventId,
                event: repairMeta,
              };
              pendingRepairRef.current = nextPending;
              setPendingRepair(nextPending);
            }
          } else {
            turnsSinceInterventionRef.current += 1;
          }
        }

        setExchanges((current) =>
          current
            .map((exchange) =>
              exchange.id === exchangeId
                ? {
                    ...exchange,
                    tutorTurn: effectiveTurn,
                    responseTimeMs,
                    storageWarning: tutorTurn.storageWarning,
                    repair: repairMeta,
                    review: reviewMeta,
                  }
                : exchange,
            )
            .slice(-MAX_EXCHANGES),
        );
        if (tutorTurn.turnId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: historyKeys.all });
        }
        setThinking(false);
        setSpeaking(true);

        try {
          await speakRef.current(effectiveTurn.reply);

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
    const previous = previousSessionIdRef.current;
    previousSessionIdRef.current = sessionId;

    if (previous === undefined || sessionId === undefined || previous === sessionId) {
      return;
    }

    requestIdRef.current += 1;
    processedRecordingRef.current = null;
    openingSeededRef.current = false;
    firstLearnerTurnRef.current = true;
    seenIssueKeysRef.current = new Set();
    turnsSinceInterventionRef.current = Number.POSITIVE_INFINITY;
    pendingRepairRef.current = null;
    pendingReviewRef.current = null;
    setPendingRepair(null);
    setPendingReview(null);
    setThinking(false);
    setSpeaking(false);
    setReplayState(null);
    setLiveTurnCount(0);
    setExchanges(
      seedExchangesFromMessages(seedMessagesRef.current ?? [], () => nextExchangeIdRef.current++),
    );
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const replay = (exchangeId: number) => {
    const target = exchangesRef.current.find((exchange) => exchange.id === exchangeId);

    if (!target?.tutorTurn || thinking || speaking || replayState !== null) {
      return;
    }

    const replayId = ++replayRequestIdRef.current;
    setReplayState({ exchangeId, status: "playing" });

    void speakRef.current(target.tutorTurn.reply)
      .then(() => {
        if (!mountedRef.current || replayRequestIdRef.current !== replayId) {
          return;
        }

        setReplayState(null);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || replayRequestIdRef.current !== replayId) {
          return;
        }

        setReplayState({ exchangeId, status: "error", error: toSpeechError(error) });
      });
  };

  const skipRepair = () => {
    const pending = pendingRepairRef.current;
    if (!pending) {
      return;
    }

    pendingRepairRef.current = null;
    setPendingRepair(null);
    setExchanges((current) =>
      current.map((exchange) =>
        exchange.id === pending.exchangeId && exchange.repair
          ? { ...exchange, repair: { ...exchange.repair, outcome: "skipped" as const } }
          : exchange,
      ),
    );
    if (pending.eventId !== undefined) {
      void updateRepairEventOutcomeRef
        .current({ eventId: pending.eventId, outcome: "skipped" })
        .catch(() => {});
    }
  };

  const skipReview = () => {
    const pending = pendingReviewRef.current;
    if (!pending) {
      return;
    }

    pendingReviewRef.current = null;
    setPendingReview(null);
    setExchanges((current) =>
      current.map((exchange) =>
        exchange.id === pending.exchangeId && exchange.review
          ? { ...exchange, review: { ...exchange.review, outcome: "skipped" as const } }
          : exchange,
      ),
    );
    void recordReviewOutcomeRef
      .current({
        reviewItemId: pending.item.id,
        outcome: "skipped",
        sessionId: sessionIdRef.current,
      })
      .catch(() => {});
  };

  return {
    ...recording,
    exchanges,
    thinking,
    speaking,
    loopState,
    replay,
    replayState,
    pendingRepair,
    skipRepair,
    pendingReview,
    skipReview,
    liveTurnCount,
  };
}
