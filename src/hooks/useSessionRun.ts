import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import type { CefrLevel } from "../types/assessment";
import type { SessionStart } from "../types/history";
import type {
  OpenSessionRequest,
  OpeningTurn,
  SessionSummaryPayload,
  SynthesizeSessionSummaryRequest,
} from "../types/session";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import {
  completeSession as defaultCompleteSession,
  startSession as defaultStartSession,
} from "../native/history";
import { applySessionToLearnerProfile as defaultApplySessionToLearnerProfile } from "../native/learnerProfile";
import {
  evaluateRepairOpportunity as defaultEvaluateRepair,
  recordRepairEvent as defaultRecordRepairEvent,
  updateRepairEventOutcome as defaultUpdateRepairEventOutcome,
} from "../native/repair";
import {
  evaluateReviewAttempt as defaultEvaluateReviewAttempt,
  recordReviewOutcome as defaultRecordReviewOutcome,
} from "../native/review";
import {
  openGuidedSession as defaultOpenGuidedSession,
  synthesizeSessionSummary as defaultSynthesizeSessionSummary,
  toSessionError,
  type SessionError,
} from "../native/session";
import { speakTutorReply } from "../native/speech";
import {
  findDurationPreset,
  type DurationPresetId,
  type SessionTemplate,
} from "../sessions/catalog";
import type {
  EvaluateRepairRequest,
  RecordRepairEventRequest,
  RepairEvaluation,
  RepairEventSummary,
  RepairIntensity,
  UpdateRepairEventOutcomeRequest,
} from "../types/repair";
import type {
  EvaluateReviewAttemptRequest,
  RecordReviewOutcomeRequest,
  ReviewAttemptEvaluation,
  ReviewItem,
} from "../types/review";
import type { TranscriptionResult } from "../types/transcription";
import type {
  BetterExpression,
  TutorCorrection,
  TutorMessage,
  TutorTurn,
  TutorTurnRequest,
} from "../types/tutor";
import { useTutorConversation } from "./useTutorConversation";

export type SessionRunStatus =
  | "catalog"
  | "starting"
  | "active"
  | "finishing"
  | "complete"
  | "error";

export type StartSessionRunOptions = {
  difficulty?: CefrLevel;
  focus?: string;
  durationPresetId?: DurationPresetId;
};

type Engine = {
  template: SessionTemplate;
  sessionId: number;
};

type UseSessionRunOptions = {
  enabled: boolean;
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
  respond?: (request: TutorTurnRequest) => Promise<TutorTurn>;
  speak?: (reply: string) => Promise<void>;
  repairIntensity?: RepairIntensity;
  evaluateRepair?: (request: EvaluateRepairRequest) => Promise<RepairEvaluation>;
  recordRepairEvent?: (request: RecordRepairEventRequest) => Promise<number>;
  updateRepairEventOutcome?: (request: UpdateRepairEventOutcomeRequest) => Promise<void>;
  evaluateReviewAttempt?: (
    request: EvaluateReviewAttemptRequest,
  ) => Promise<ReviewAttemptEvaluation>;
  recordReviewOutcome?: (request: RecordReviewOutcomeRequest) => Promise<void>;
  startSession?: (request: {
    scenarioId: string;
    difficulty?: CefrLevel;
    focus?: string;
    targetTurns: number;
  }) => Promise<SessionStart>;
  completeSession?: (request: {
    sessionId: number;
    status: "completed" | "abandoned";
    summary?: SessionSummaryPayload;
  }) => Promise<void>;
  openGuidedSession?: (request: OpenSessionRequest) => Promise<OpeningTurn>;
  synthesizeSessionSummary?: (
    request: SynthesizeSessionSummaryRequest,
  ) => Promise<SessionSummaryPayload>;
  applySessionToLearnerProfile?: (request: {
    scenarioLabel: string;
    priorities: string[];
  }) => Promise<unknown>;
};

export function useSessionRun({
  enabled,
  recorder,
  transcribe,
  respond,
  speak = speakTutorReply,
  repairIntensity = "balanced",
  evaluateRepair = defaultEvaluateRepair,
  recordRepairEvent = defaultRecordRepairEvent,
  updateRepairEventOutcome = defaultUpdateRepairEventOutcome,
  evaluateReviewAttempt = defaultEvaluateReviewAttempt,
  recordReviewOutcome = defaultRecordReviewOutcome,
  startSession = defaultStartSession,
  completeSession = defaultCompleteSession,
  openGuidedSession = defaultOpenGuidedSession,
  synthesizeSessionSummary = defaultSynthesizeSessionSummary,
  applySessionToLearnerProfile = defaultApplySessionToLearnerProfile,
}: UseSessionRunOptions) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionRunStatus>("catalog");
  const [template, setTemplate] = useState<SessionTemplate | undefined>();
  const [targetTurns, setTargetTurns] = useState<number | undefined>();
  const [summary, setSummary] = useState<SessionSummaryPayload | undefined>();
  const [error, setError] = useState<SessionError | undefined>();
  const [conversationSessionId, setConversationSessionId] = useState<number | undefined>();
  const [conversationLearnerContext, setConversationLearnerContext] = useState<
    string | undefined
  >();
  const [openingReply, setOpeningReply] = useState<string | undefined>();
  const [dueReviewItems, setDueReviewItems] = useState<ReviewItem[]>([]);

  const engineRef = useRef<Engine | null>(null);
  const statusRef = useRef(status);
  const mountedRef = useRef(true);
  const completeSessionRef = useRef(completeSession);

  statusRef.current = status;
  completeSessionRef.current = completeSession;

  const conversation = useTutorConversation({
    enabled: enabled && status === "active",
    recorder,
    transcribe,
    respond,
    speak,
    sessionId: conversationSessionId,
    learnerContext: conversationLearnerContext,
    openingReply,
    repairIntensity,
    evaluateRepair,
    recordRepairEvent,
    updateRepairEventOutcome,
    dueReviewItems,
    evaluateReviewAttempt,
    recordReviewOutcome,
  });

  const turnCount = conversation.exchanges.filter(
    (exchange) => exchange.transcript && exchange.tutorTurn,
  ).length;

  function handleError(caughtError: unknown) {
    if (!mountedRef.current) {
      return;
    }
    setError(toSessionError(caughtError));
    setStatus("error");
  }

  async function start(chosenTemplate: SessionTemplate, options: StartSessionRunOptions = {}) {
    if (status !== "catalog" && status !== "error" && status !== "complete") {
      return;
    }

    setError(undefined);
    setSummary(undefined);
    setOpeningReply(undefined);
    setConversationSessionId(undefined);
    setConversationLearnerContext(undefined);
    setDueReviewItems([]);
    setTemplate(chosenTemplate);
    setStatus("starting");

    const preset = findDurationPreset(options.durationPresetId ?? "standard");
    setTargetTurns(preset.targetTurns);

    const engine: Engine = { template: chosenTemplate, sessionId: -1 };
    engineRef.current = engine;

    let started: SessionStart;
    try {
      started = await startSession({
        scenarioId: chosenTemplate.id,
        difficulty: options.difficulty,
        focus: options.focus,
        targetTurns: preset.targetTurns,
      });
    } catch (startError: unknown) {
      if (engineRef.current === engine) {
        handleError(startError);
      }
      return;
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }
    engine.sessionId = started.sessionId;

    let opening: string;
    try {
      const openingTurn = await openGuidedSession({
        scenarioSystemPrompt: chosenTemplate.scenarioSystemPrompt,
        learnerContext: started.learnerContext,
      });
      opening = openingTurn.opening;
    } catch (openingError: unknown) {
      if (engineRef.current === engine) {
        handleError(openingError);
      }
      return;
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    try {
      await speak(opening);
    } catch {
      // A failed opener playback shouldn't block the session — the opening
      // line is still shown in the transcript and the learner can continue.
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    const mergedContext = [chosenTemplate.scenarioSystemPrompt, started.learnerContext]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join("\n\n");

    setConversationSessionId(engine.sessionId);
    setConversationLearnerContext(mergedContext || undefined);
    setDueReviewItems(started.dueReviewItems ?? []);
    setOpeningReply(opening);
    setStatus("active");
  }

  async function finish() {
    const engine = engineRef.current;
    if (!engine || status !== "active" || !mountedRef.current) {
      return;
    }
    setStatus("finishing");

    const turns: TutorMessage[] = [];
    const corrections: TutorCorrection[] = [];
    const betterExpressions: BetterExpression[] = [];
    const repairEvents: RepairEventSummary[] = [];
    for (const exchange of conversation.exchanges) {
      if (exchange.transcript) {
        turns.push({ role: "user", content: exchange.transcript });
      }
      if (exchange.tutorTurn) {
        turns.push({ role: "assistant", content: exchange.tutorTurn.reply });
        corrections.push(...exchange.tutorTurn.corrections);
        betterExpressions.push(...exchange.tutorTurn.betterExpressions);
      }
      if (exchange.repair) {
        repairEvents.push({
          priority: exchange.repair.priority,
          issue: exchange.repair.issue,
          mode: exchange.repair.mode,
          outcome: exchange.repair.outcome,
        });
      }
    }

    let summaryPayload: SessionSummaryPayload | undefined;
    try {
      summaryPayload = await synthesizeSessionSummary({
        scenarioLabel: engine.template.label,
        turns,
        corrections,
        betterExpressions,
        repairEvents,
      });
    } catch {
      // Wording is secondary to a valid completion — proceed without it.
      summaryPayload = undefined;
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    try {
      await completeSession({
        sessionId: engine.sessionId,
        status: "completed",
        summary: summaryPayload,
      });
    } catch (completeError: unknown) {
      if (engineRef.current === engine) {
        handleError(completeError);
      }
      return;
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    try {
      await applySessionToLearnerProfile({
        scenarioLabel: engine.template.label,
        priorities: summaryPayload?.priorityIssues ?? [],
      });
      void queryClient.invalidateQueries({ queryKey: learnerProfileKeys.all });
    } catch {
      // The learner profile update is supplementary — a failure here must
      // not discard an otherwise-valid, completed session.
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    setSummary(summaryPayload);
    setStatus("complete");
  }

  async function abandon() {
    const engine = engineRef.current;
    if (!engine || status !== "active" || !mountedRef.current) {
      return;
    }
    try {
      await completeSession({ sessionId: engine.sessionId, status: "abandoned" });
    } catch {
      // Best-effort — returning to the catalog shouldn't be blocked by this.
    }
    if (engineRef.current !== engine) {
      return;
    }
    engineRef.current = null;
    reset();
  }

  function reset() {
    engineRef.current = null;
    setStatus("catalog");
    setTemplate(undefined);
    setTargetTurns(undefined);
    setSummary(undefined);
    setError(undefined);
    setConversationSessionId(undefined);
    setConversationLearnerContext(undefined);
    setDueReviewItems([]);
    setOpeningReply(undefined);
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const engine = engineRef.current;
      if (engine && statusRef.current === "active") {
        void completeSessionRef
          .current({ sessionId: engine.sessionId, status: "abandoned" })
          .catch(() => {});
      }
    };
  }, []);

  return {
    status,
    template,
    targetTurns,
    turnCount,
    summary,
    error,
    start,
    finish,
    abandon,
    reset,
    conversation,
  };
}
