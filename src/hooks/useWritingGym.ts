import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import { writingKeys } from "../queryKeys/writing";
import {
  startWritingTask as defaultStartWritingTask,
  submitWritingDraft as defaultSubmitWritingDraft,
  submitWritingRewrite as defaultSubmitWritingRewrite,
  toWritingError,
  type WritingError,
} from "../native/writing";
import type {
  StartWritingTaskRequest,
  SubmitWritingDraftRequest,
  SubmitWritingRewriteRequest,
  WritingComparisonResult,
  WritingEvaluationResult,
  WritingTask,
  WritingTaskBlueprint,
} from "../types/writing";

export type WritingGymStatus =
  | "catalog"
  | "drafting"
  | "evaluatingDraft"
  | "draftFeedback"
  | "rewriting"
  | "evaluatingRewrite"
  | "comparison"
  | "error";

type Engine = {
  writingTaskId: number;
  blueprint: WritingTaskBlueprint;
};

type UseWritingGymOptions = {
  startWritingTask?: (request: StartWritingTaskRequest) => Promise<WritingTask>;
  submitWritingDraft?: (request: SubmitWritingDraftRequest) => Promise<WritingEvaluationResult>;
  submitWritingRewrite?: (
    request: SubmitWritingRewriteRequest,
  ) => Promise<WritingComparisonResult>;
};

export function useWritingGym({
  startWritingTask = defaultStartWritingTask,
  submitWritingDraft = defaultSubmitWritingDraft,
  submitWritingRewrite = defaultSubmitWritingRewrite,
}: UseWritingGymOptions = {}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WritingGymStatus>("catalog");
  const [blueprint, setBlueprint] = useState<WritingTaskBlueprint | undefined>();
  const [draftText, setDraftText] = useState<string | undefined>();
  const [draftEvaluation, setDraftEvaluation] = useState<WritingEvaluationResult | undefined>();
  const [rewriteText, setRewriteText] = useState<string | undefined>();
  const [comparison, setComparison] = useState<WritingComparisonResult | undefined>();
  const [error, setError] = useState<WritingError | undefined>();

  const engineRef = useRef<Engine | null>(null);

  function handleError(engine: Engine | null, caughtError: unknown) {
    if (engineRef.current !== engine) {
      return;
    }
    setError(toWritingError(caughtError));
    setStatus("error");
  }

  async function selectTask(chosenBlueprint: WritingTaskBlueprint) {
    if (status !== "catalog" && status !== "error") {
      return;
    }

    setError(undefined);
    setDraftText(undefined);
    setDraftEvaluation(undefined);
    setRewriteText(undefined);
    setComparison(undefined);
    setBlueprint(chosenBlueprint);
    setStatus("drafting");

    const engine: Engine = { writingTaskId: -1, blueprint: chosenBlueprint };
    engineRef.current = engine;

    try {
      const task = await startWritingTask({ taskType: chosenBlueprint.taskType });
      if (engineRef.current !== engine) {
        return;
      }
      engine.writingTaskId = task.id;
    } catch (startError: unknown) {
      handleError(engine, startError);
    }
  }

  async function submitDraft(text: string) {
    const engine = engineRef.current;
    if (!engine || status !== "drafting" || engine.writingTaskId < 0) {
      return;
    }
    setStatus("evaluatingDraft");

    try {
      const evaluation = await submitWritingDraft({
        writingTaskId: engine.writingTaskId,
        taskType: engine.blueprint.taskType,
        draftText: text,
      });
      if (engineRef.current !== engine) {
        return;
      }
      setDraftText(text);
      setDraftEvaluation(evaluation);
      setStatus("draftFeedback");
    } catch (draftError: unknown) {
      handleError(engine, draftError);
    }
  }

  function startRewrite() {
    if (status !== "draftFeedback") {
      return;
    }
    setStatus("rewriting");
  }

  async function submitRewrite(text: string) {
    const engine = engineRef.current;
    if (!engine || status !== "rewriting") {
      return;
    }
    setStatus("evaluatingRewrite");

    try {
      const result = await submitWritingRewrite({
        writingTaskId: engine.writingTaskId,
        taskType: engine.blueprint.taskType,
        rewriteText: text,
      });
      if (engineRef.current !== engine) {
        return;
      }
      setRewriteText(text);
      setComparison(result);
      setStatus("comparison");
      void queryClient.invalidateQueries({ queryKey: learnerProfileKeys.all });
      void queryClient.invalidateQueries({ queryKey: writingKeys.all });
    } catch (rewriteError: unknown) {
      handleError(engine, rewriteError);
    }
  }

  function reset() {
    engineRef.current = null;
    setStatus("catalog");
    setBlueprint(undefined);
    setDraftText(undefined);
    setDraftEvaluation(undefined);
    setRewriteText(undefined);
    setComparison(undefined);
    setError(undefined);
  }

  return {
    status,
    blueprint,
    draftText,
    draftEvaluation,
    rewriteText,
    comparison,
    error,
    selectTask,
    submitDraft,
    startRewrite,
    submitRewrite,
    reset,
  };
}
