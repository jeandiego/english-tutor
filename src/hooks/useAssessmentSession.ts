import { useEffect, useRef, useState } from "react";
import { aggregateResult } from "../assessment/aggregator";
import { BLUEPRINT_TASKS, BLUEPRINT_VERSION } from "../assessment/blueprint";
import {
  RUBRIC_VERSION,
  adjustDifficulty,
  applyEvidence,
  beginTaskRun,
  createInitialState,
  recordFollowUp,
  selectNextStep,
  stop as stopController,
  type AssessmentState,
  type StopReason,
} from "../assessment/controller";
import type { AssessmentTask } from "../assessment/types";
import type { AudioRecorder, RecordedAudio } from "../audio/recorder";
import {
  completeAssessment,
  completeAssessmentTaskRun,
  evaluateResponse,
  generateFollowUp,
  recordAssessmentTurnCycle,
  startAssessment,
  startAssessmentTaskRun,
  synthesizeAssessmentSummary,
  toAssessmentError,
  type AssessmentError,
} from "../native/assessment";
import { applyAssessmentToLearnerProfile } from "../native/learnerProfile";
import { speakTutorReply, toSpeechError } from "../native/speech";
import type {
  AggregatedResult,
  AssessmentCompetency,
  AssessmentSummaryText,
  CefrLevel,
  CompetencyEvidenceResult,
  EvaluationResult,
  FollowUpIntent,
} from "../types/assessment";
import type { TranscriptionResult } from "../types/transcription";
import { usePushToTalk } from "./usePushToTalk";

export type AssessmentSessionStatus =
  | "idle"
  | "asking"
  | "awaitingAnswer"
  | "evaluating"
  | "finalizing"
  | "complete"
  | "error";

export type AssessmentExchange = {
  id: number;
  taskId: string;
  stage: "anchor" | "follow_up";
  question: string;
  answer: string;
  evidence: CompetencyEvidenceResult[];
};

type PendingPrompt = {
  text: string;
  stage: "anchor" | "follow_up";
  task: AssessmentTask;
  intent?: FollowUpIntent;
};

type Engine = {
  state: AssessmentState;
  assessmentId: number | null;
  taskRunDbId: number | null;
  pendingPrompt: PendingPrompt | null;
};

type UseAssessmentSessionOptions = {
  enabled: boolean;
  tasks?: AssessmentTask[];
  recorder?: AudioRecorder;
  transcribe?: (recording: RecordedAudio) => Promise<TranscriptionResult>;
  speak?: (text: string) => Promise<void>;
};

function evidenceQuotesFor(
  exchanges: AssessmentExchange[],
  competency: AssessmentCompetency,
): string[] {
  return exchanges
    .flatMap((exchange) => exchange.evidence)
    .filter((entry) => entry.competency === competency && !entry.insufficientEvidence)
    .flatMap((entry) => entry.evidence);
}

export function useAssessmentSession({
  enabled,
  tasks = BLUEPRINT_TASKS,
  recorder,
  transcribe,
  speak = speakTutorReply,
}: UseAssessmentSessionOptions) {
  const [status, setStatus] = useState<AssessmentSessionStatus>("idle");
  const [currentQuestion, setCurrentQuestion] = useState<string | undefined>();
  const [exchanges, setExchanges] = useState<AssessmentExchange[]>([]);
  const [result, setResult] = useState<AggregatedResult | undefined>();
  const [summary, setSummary] = useState<AssessmentSummaryText | undefined>();
  const [error, setError] = useState<AssessmentError | undefined>();

  const mountedRef = useRef(true);
  const tasksRef = useRef(tasks);
  const speakRef = useRef(speak);
  const engineRef = useRef<Engine | null>(null);
  const exchangesRef = useRef<AssessmentExchange[]>([]);
  const nextExchangeIdRef = useRef(1);
  const processedRecordingRef = useRef<RecordedAudio | null>(null);

  tasksRef.current = tasks;
  speakRef.current = speak;

  const recording = usePushToTalk({
    enabled: enabled && status === "awaitingAnswer",
    recorder,
    transcribe,
  });

  function handleError(error: unknown) {
    if (!mountedRef.current) {
      return;
    }
    setError(toAssessmentError(error));
    setStatus("error");
  }

  async function speakPrompt(engine: Engine, text: string) {
    try {
      await speakRef.current(text);
    } catch (speechError: unknown) {
      if (!mountedRef.current || engineRef.current !== engine) {
        return;
      }
      handleError(toSpeechError(speechError));
      return;
    }
    if (!mountedRef.current || engineRef.current !== engine) {
      return;
    }
    setCurrentQuestion(text);
    setStatus("awaitingAnswer");
  }

  async function advance() {
    const engine = engineRef.current;
    if (!engine || engine.assessmentId === null || !mountedRef.current) {
      return;
    }

    const step = selectNextStep(engine.state);

    if (step.kind === "stop") {
      await finalize(engine, step.reason);
      return;
    }

    if (step.kind === "anchor") {
      setStatus("asking");
      let taskRunId: number;
      try {
        const started = await startAssessmentTaskRun({
          assessmentId: engine.assessmentId,
          taskId: step.task.id,
          targetCefrMin: step.task.cefrRange.min,
          targetCefrMax: step.task.cefrRange.max,
          difficulty: engine.state.currentDifficulty,
          anchorUsed: true,
        });
        taskRunId = started.taskRunId;
      } catch (requestError: unknown) {
        if (engineRef.current === engine) {
          handleError(requestError);
        }
        return;
      }
      if (engineRef.current !== engine) {
        return;
      }
      engine.state = beginTaskRun(engine.state, step.task);
      engine.taskRunDbId = taskRunId;
      engine.pendingPrompt = {
        text: step.task.anchorPrompt,
        stage: "anchor",
        task: step.task,
      };
      await speakPrompt(engine, step.task.anchorPrompt);
      return;
    }

    // step.kind === "follow_up"
    setStatus("asking");
    const previous = exchangesRef.current[exchangesRef.current.length - 1];
    try {
      const followUp = await generateFollowUp({
        targetCefr: step.targetCefr,
        followUpIntent: step.intent,
        previousQuestion: previous?.question ?? step.task.anchorPrompt,
        learnerAnswer: previous?.answer ?? "",
        constraints: { requiresSpecialistKnowledge: false, maxQuestions: 1 },
      });
      if (engineRef.current !== engine) {
        return;
      }
      engine.state = recordFollowUp(engine.state, step.intent);
      engine.pendingPrompt = {
        text: followUp.question,
        stage: "follow_up",
        task: step.task,
        intent: step.intent,
      };
      await speakPrompt(engine, followUp.question);
    } catch (requestError: unknown) {
      if (engineRef.current === engine) {
        handleError(requestError);
      }
    }
  }

  async function handleAnswer(answerText: string) {
    const engine = engineRef.current;
    if (!engine || !engine.pendingPrompt || engine.taskRunDbId === null) {
      return;
    }
    const prompt = engine.pendingPrompt;
    const taskRunId = engine.taskRunDbId;
    setStatus("evaluating");

    let evaluation: EvaluationResult;
    try {
      evaluation = await evaluateResponse({
        taskId: prompt.task.id,
        targetCefrRange: prompt.task.cefrRange,
        competencies: prompt.task.competencies,
        requiredFunctions: prompt.task.requiredFunctions,
        question: prompt.text,
        learnerAnswer: answerText,
      });
    } catch (requestError: unknown) {
      if (engineRef.current === engine) {
        handleError(requestError);
      }
      return;
    }
    if (engineRef.current !== engine) {
      return;
    }

    try {
      await recordAssessmentTurnCycle({
        taskRunId,
        promptText: prompt.text,
        answerText,
        followUpIntent: prompt.intent,
        evidence: evaluation.competencyEvidence.map((entry) => ({
          competency: entry.competency,
          levelEvidence: entry.levelEvidence,
          confidence: entry.confidence,
          evidence: entry.evidence,
        })),
      });
    } catch (requestError: unknown) {
      if (engineRef.current === engine) {
        handleError(requestError);
      }
      return;
    }
    if (engineRef.current !== engine) {
      return;
    }

    const exchange: AssessmentExchange = {
      id: nextExchangeIdRef.current++,
      taskId: prompt.task.id,
      stage: prompt.stage,
      question: prompt.text,
      answer: answerText,
      evidence: evaluation.competencyEvidence,
    };
    exchangesRef.current = [...exchangesRef.current, exchange];
    if (mountedRef.current) {
      setExchanges(exchangesRef.current);
    }

    engine.state = applyEvidence(engine.state, evaluation.competencyEvidence);
    engine.state = adjustDifficulty(engine.state, evaluation.competencyEvidence);
    engine.pendingPrompt = null;

    await advance();
  }

  async function finalize(engine: Engine, reason: StopReason) {
    if (engine.assessmentId === null) {
      return;
    }
    setStatus("finalizing");

    if (engine.taskRunDbId !== null) {
      const lastRecord = engine.state.taskRuns[engine.state.taskRuns.length - 1];
      try {
        await completeAssessmentTaskRun({
          taskRunId: engine.taskRunDbId,
          followUpsUsed: lastRecord?.followUpIntentsUsed.length ?? 0,
        });
      } catch (requestError: unknown) {
        if (engineRef.current === engine) {
          handleError(requestError);
        }
        return;
      }
      if (engineRef.current !== engine) {
        return;
      }
    }

    engine.state = stopController(engine.state, reason);
    const aggregated = aggregateResult(engine.state);

    let summaryText: AssessmentSummaryText | undefined;
    try {
      summaryText = await synthesizeAssessmentSummary({
        overallLevel:
          aggregated.overallLevel === "insufficient_evidence"
            ? undefined
            : aggregated.overallLevel,
        overallConfidence: aggregated.overallConfidence,
        competencyProfiles: aggregated.competencyProfiles.map((profile) => ({
          competency: profile.competency,
          level: profile.level === "insufficient_evidence" ? undefined : profile.level,
          confidence: profile.confidence,
          evidence: evidenceQuotesFor(exchangesRef.current, profile.competency),
        })),
      });
    } catch {
      // Recommendation wording is secondary to the computed result — a
      // failed summary call must not discard an otherwise-valid,
      // evidence-backed assessment.
      summaryText = undefined;
    }
    if (engineRef.current !== engine) {
      return;
    }

    try {
      await completeAssessment({
        assessmentId: engine.assessmentId,
        estimatedLevel:
          aggregated.overallLevel === "insufficient_evidence"
            ? undefined
            : aggregated.overallLevel,
        confidence: aggregated.overallConfidence,
      });
    } catch (requestError: unknown) {
      if (engineRef.current === engine) {
        handleError(requestError);
      }
      return;
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    try {
      const dimensionLevels: Partial<Record<AssessmentCompetency, CefrLevel>> = {};
      for (const profile of aggregated.competencyProfiles) {
        if (profile.level !== "insufficient_evidence") {
          dimensionLevels[profile.competency] = profile.level;
        }
      }
      await applyAssessmentToLearnerProfile({
        overallLevel:
          aggregated.overallLevel === "insufficient_evidence"
            ? undefined
            : aggregated.overallLevel,
        dimensionLevels,
        priorities: summaryText?.priorities ?? [],
      });
    } catch {
      // The learner profile is supplementary context for the tutor — a
      // failed update must not discard an otherwise-valid, evidence-backed
      // assessment result.
    }
    if (engineRef.current !== engine || !mountedRef.current) {
      return;
    }

    setResult(aggregated);
    setSummary(summaryText);
    setCurrentQuestion(undefined);
    setStatus("complete");
  }

  function start() {
    if (status !== "idle" && status !== "error" && status !== "complete") {
      return;
    }

    setError(undefined);
    setResult(undefined);
    setSummary(undefined);
    setExchanges([]);
    exchangesRef.current = [];
    nextExchangeIdRef.current = 1;
    processedRecordingRef.current = null;

    const engine: Engine = {
      state: createInitialState(tasksRef.current, BLUEPRINT_VERSION, RUBRIC_VERSION),
      assessmentId: null,
      taskRunDbId: null,
      pendingPrompt: null,
    };
    engineRef.current = engine;
    setStatus("asking");

    void (async () => {
      try {
        const started = await startAssessment({
          blueprintVersion: BLUEPRINT_VERSION,
          rubricVersion: RUBRIC_VERSION,
        });
        if (engineRef.current !== engine) {
          return;
        }
        engine.assessmentId = started.assessmentId;
      } catch (requestError: unknown) {
        if (engineRef.current === engine) {
          handleError(requestError);
        }
        return;
      }
      await advance();
    })();
  }

  function retake() {
    start();
  }

  useEffect(() => {
    if (
      recording.state.status !== "transcribed" ||
      processedRecordingRef.current === recording.state.recording
    ) {
      return;
    }
    processedRecordingRef.current = recording.state.recording;
    void handleAnswer(recording.state.text);
  }, [recording.state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      engineRef.current = null;
    };
  }, []);

  return {
    ...recording,
    status,
    currentQuestion,
    exchanges,
    result,
    summary,
    error,
    start,
    retake,
  };
}
