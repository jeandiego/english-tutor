import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { randomExerciseTemplate, type ExerciseTemplate } from "../chunk/exerciseTemplates";
import { chunkReviewItemType } from "../chunk/labels";
import { chunkKeys } from "../queryKeys/chunk";
import {
  recordLexicalChunkAttempt as defaultRecordLexicalChunkAttempt,
} from "../native/chunk";
import { evaluateReviewAttempt as defaultEvaluateReviewAttempt } from "../native/review";
import type { LexicalChunk, RecordLexicalChunkAttemptRequest } from "../types/chunk";
import type { EvaluateReviewAttemptRequest, ReviewAttemptEvaluation } from "../types/review";

export type ChunkPracticeStatus = "idle" | "answering" | "evaluating" | "result";

type Engine = {
  chunk: LexicalChunk;
};

type NormalizedError = { message: string; technicalMessage: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mirrors the `isRecord`-based normalization every `native/*.ts` error
 * class already does — needed here because a practice attempt can fail at
 * either the evaluate step (`ReviewError`) or the record step (`ChunkError`),
 * and both (like any plain `{code, message}` rejection a test injects)
 * share this shape without a common base class. */
function normalizeError(error: unknown): NormalizedError {
  if (isRecord(error)) {
    const message = typeof error.message === "string" ? error.message : undefined;
    const technicalMessage =
      typeof error.technicalMessage === "string" ? error.technicalMessage : message;
    if (message) {
      return { message, technicalMessage: technicalMessage ?? message };
    }
  }
  const technicalMessage = error instanceof Error ? error.message : String(error);
  return { message: "The practice attempt could not continue.", technicalMessage };
}

type UseChunkPracticeOptions = {
  evaluateReviewAttempt?: (request: EvaluateReviewAttemptRequest) => Promise<ReviewAttemptEvaluation>;
  recordLexicalChunkAttempt?: (request: RecordLexicalChunkAttemptRequest) => Promise<LexicalChunk>;
};

export function useChunkPractice({
  evaluateReviewAttempt = defaultEvaluateReviewAttempt,
  recordLexicalChunkAttempt = defaultRecordLexicalChunkAttempt,
}: UseChunkPracticeOptions = {}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ChunkPracticeStatus>("idle");
  const [chunk, setChunk] = useState<LexicalChunk | undefined>();
  const [template, setTemplate] = useState<ExerciseTemplate | undefined>();
  const [evaluation, setEvaluation] = useState<ReviewAttemptEvaluation | undefined>();
  const [updatedChunk, setUpdatedChunk] = useState<LexicalChunk | undefined>();
  const [error, setError] = useState<NormalizedError | undefined>();

  const engineRef = useRef<Engine | null>(null);

  function start(chosenChunk: LexicalChunk) {
    setError(undefined);
    setEvaluation(undefined);
    setUpdatedChunk(undefined);
    setChunk(chosenChunk);
    setTemplate(randomExerciseTemplate(chosenChunk));
    setStatus("answering");
    engineRef.current = { chunk: chosenChunk };
  }

  async function submit(transcript: string) {
    const engine = engineRef.current;
    if (!engine || !template || status !== "answering" || transcript.trim().length === 0) {
      return;
    }
    setStatus("evaluating");

    try {
      const result = await evaluateReviewAttempt({
        itemType: chunkReviewItemType(engine.chunk.chunkType),
        content: `${engine.chunk.text} — ${engine.chunk.meaning}`,
        transcript,
        history: [],
      });
      if (engineRef.current !== engine) {
        return;
      }
      setEvaluation(result);

      const updated = await recordLexicalChunkAttempt({
        chunkId: engine.chunk.id,
        exerciseType: template.exerciseType,
        modality: template.modality,
        prompt: template.instruction,
        transcript,
        outcome: result.outcome,
      });
      if (engineRef.current !== engine) {
        return;
      }
      setUpdatedChunk(updated);
      setStatus("result");
      void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
    } catch (caughtError: unknown) {
      if (engineRef.current !== engine) {
        return;
      }
      setError(normalizeError(caughtError));
      setStatus("answering");
    }
  }

  function reset() {
    engineRef.current = null;
    setStatus("idle");
    setChunk(undefined);
    setTemplate(undefined);
    setEvaluation(undefined);
    setUpdatedChunk(undefined);
    setError(undefined);
  }

  return {
    status,
    chunk,
    template,
    evaluation,
    updatedChunk,
    error,
    start,
    submit,
    reset,
  };
}
