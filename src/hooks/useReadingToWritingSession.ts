import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { chunkKeys } from "../queryKeys/chunk";
import { readingKeys } from "../queryKeys/reading";
import {
  acceptReadingChunks as defaultAcceptReadingChunks,
  startReadingSession as defaultStartReadingSession,
  submitReadingComprehensionAnswer as defaultSubmitReadingComprehensionAnswer,
  submitReadingProduction as defaultSubmitReadingProduction,
  toReadingError,
  type ReadingError,
} from "../native/reading";
import type {
  AcceptReadingChunksRequest,
  ReadingComprehensionResult,
  ReadingEvaluationResult,
  ReadingSessionAttempt,
  ReadingTargetChunk,
  ReadingText,
  StartReadingSessionRequest,
  SubmitReadingComprehensionAnswerRequest,
  SubmitReadingProductionRequest,
} from "../types/reading";
import type { LexicalChunk } from "../types/chunk";

export type ReadingToWritingStatus =
  | "catalog"
  | "reading"
  | "chunkSelection"
  | "production"
  | "evaluating"
  | "feedback"
  | "error";

export const MIN_ACCEPTED_CHUNKS = 3;
export const MAX_ACCEPTED_CHUNKS = 5;

type Engine = {
  attemptId: number;
  text: ReadingText;
};

type UseReadingToWritingSessionOptions = {
  startReadingSession?: (request: StartReadingSessionRequest) => Promise<ReadingSessionAttempt>;
  submitReadingComprehensionAnswer?: (
    request: SubmitReadingComprehensionAnswerRequest,
  ) => Promise<ReadingComprehensionResult>;
  acceptReadingChunks?: (request: AcceptReadingChunksRequest) => Promise<LexicalChunk[]>;
  submitReadingProduction?: (
    request: SubmitReadingProductionRequest,
  ) => Promise<ReadingEvaluationResult>;
};

export function useReadingToWritingSession({
  startReadingSession = defaultStartReadingSession,
  submitReadingComprehensionAnswer = defaultSubmitReadingComprehensionAnswer,
  acceptReadingChunks = defaultAcceptReadingChunks,
  submitReadingProduction = defaultSubmitReadingProduction,
}: UseReadingToWritingSessionOptions = {}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReadingToWritingStatus>("catalog");
  const [text, setText] = useState<ReadingText | undefined>();
  const [comprehensionResult, setComprehensionResult] = useState<
    ReadingComprehensionResult | undefined
  >();
  const [selectedChunks, setSelectedChunks] = useState<LexicalChunk[]>([]);
  const [evaluation, setEvaluation] = useState<ReadingEvaluationResult | undefined>();
  const [error, setError] = useState<ReadingError | undefined>();

  const engineRef = useRef<Engine | null>(null);

  function handleError(engine: Engine | null, caughtError: unknown) {
    if (engineRef.current !== engine) {
      return;
    }
    setError(toReadingError(caughtError));
    setStatus("error");
  }

  async function selectText(chosenText: ReadingText) {
    if (status !== "catalog" && status !== "error") {
      return;
    }

    setError(undefined);
    setComprehensionResult(undefined);
    setSelectedChunks([]);
    setEvaluation(undefined);
    setText(chosenText);
    setStatus("reading");

    const engine: Engine = { attemptId: -1, text: chosenText };
    engineRef.current = engine;

    try {
      const attempt = await startReadingSession({ textId: chosenText.id });
      if (engineRef.current !== engine) {
        return;
      }
      engine.attemptId = attempt.id;
    } catch (startError: unknown) {
      handleError(engine, startError);
    }
  }

  async function submitComprehensionAnswer(selectedOptionIndex: number) {
    const engine = engineRef.current;
    if (!engine || status !== "reading" || engine.attemptId < 0) {
      return;
    }

    try {
      const result = await submitReadingComprehensionAnswer({
        attemptId: engine.attemptId,
        correctOptionIndex: engine.text.comprehensionCheck.correctOptionIndex,
        selectedOptionIndex,
      });
      if (engineRef.current !== engine) {
        return;
      }
      setComprehensionResult(result);
      setStatus("chunkSelection");
    } catch (answerError: unknown) {
      handleError(engine, answerError);
    }
  }

  async function confirmChunks(chunks: ReadingTargetChunk[]) {
    const engine = engineRef.current;
    if (!engine || status !== "chunkSelection") {
      return;
    }
    if (chunks.length < MIN_ACCEPTED_CHUNKS || chunks.length > MAX_ACCEPTED_CHUNKS) {
      return;
    }

    try {
      const created = await acceptReadingChunks({
        attemptId: engine.attemptId,
        targetLevel: engine.text.level,
        chunks: chunks.map((chunk) => ({
          chunkType: chunk.chunkType,
          text: chunk.text,
          meaning: chunk.meaning,
          register: chunk.register,
        })),
      });
      if (engineRef.current !== engine) {
        return;
      }
      setSelectedChunks(created);
      setStatus("production");
      void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
    } catch (chunkError: unknown) {
      handleError(engine, chunkError);
    }
  }

  async function submitProduction(summaryText: string, responseText: string) {
    const engine = engineRef.current;
    if (!engine || status !== "production") {
      return;
    }
    setStatus("evaluating");

    try {
      const result = await submitReadingProduction({
        attemptId: engine.attemptId,
        readingTextBody: engine.text.body,
        summaryPrompt: engine.text.summaryPrompt,
        responsePrompt: engine.text.responsePrompt,
        summaryText,
        responseText,
      });
      if (engineRef.current !== engine) {
        return;
      }
      setEvaluation(result);
      setStatus("feedback");
      void queryClient.invalidateQueries({ queryKey: readingKeys.all });
    } catch (productionError: unknown) {
      handleError(engine, productionError);
    }
  }

  function reset() {
    engineRef.current = null;
    setStatus("catalog");
    setText(undefined);
    setComprehensionResult(undefined);
    setSelectedChunks([]);
    setEvaluation(undefined);
    setError(undefined);
  }

  return {
    status,
    text,
    comprehensionResult,
    selectedChunks,
    evaluation,
    error,
    selectText,
    submitComprehensionAnswer,
    confirmChunks,
    submitProduction,
    reset,
  };
}
