import { z } from "zod";
import type { CefrLevel } from "./assessment";
import type { LexicalChunkType } from "./chunk";

const CEFR_LEVELS: [CefrLevel, ...CefrLevel[]] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LEXICAL_CHUNK_TYPES: [LexicalChunkType, ...LexicalChunkType[]] = [
  "single_word",
  "collocation",
  "phrase",
  "discourse_marker",
  "hedging_expression",
  "stance_phrase",
  "register_specific_expression",
  "domain_specific_expression",
];

export const READING_TEXT_TYPES = [
  "professional_email",
  "technical_article",
  "product_update",
  "opinion_piece",
  "workplace_scenario",
  "short_narrative",
] as const;

export type ReadingTextType = (typeof READING_TEXT_TYPES)[number];

const nonEmptyString = z.string().trim().min(1);

export const readingComprehensionCheckSchema = z.object({
  question: nonEmptyString,
  options: z.array(nonEmptyString).length(3),
  correctOptionIndex: z.number().int().min(0).max(2),
});

export const readingTargetChunkSchema = z.object({
  text: nonEmptyString,
  meaning: nonEmptyString,
  register: nonEmptyString,
  chunkType: z.enum(LEXICAL_CHUNK_TYPES),
});

export const readingTextSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case (e.g. professional-email-project-delay)"),
  title: nonEmptyString,
  level: z.enum(CEFR_LEVELS),
  theme: nonEmptyString,
  textType: z.enum(READING_TEXT_TYPES),
  body: z.string().trim().min(1),
  targetChunks: z.array(readingTargetChunkSchema).min(3).max(6),
  comprehensionCheck: readingComprehensionCheckSchema,
  summaryPrompt: nonEmptyString,
  responsePrompt: nonEmptyString,
});

export type ReadingComprehensionCheck = z.infer<typeof readingComprehensionCheckSchema>;
export type ReadingTargetChunk = z.infer<typeof readingTargetChunkSchema>;
export type ReadingText = z.infer<typeof readingTextSchema>;

// ---------------------------------------------------------------------
// Session DTOs — mirror the Rust `reading.rs` command layer
// ---------------------------------------------------------------------

export type ReadingSessionStatus =
  | "reading"
  | "comprehension_answered"
  | "chunks_selected"
  | "summary_submitted"
  | "evaluated";

export type SummaryFidelity = "faithful" | "partially_faithful" | "unfaithful";

export type ResponseRelevance = "relevant" | "partially_relevant" | "off_topic";

export type ReadingIssueCategory = "summary" | "response";

export type ReadingPriorityIssueResult = {
  category: ReadingIssueCategory;
  original: string;
  suggested: string;
  explanation: string;
};

export type ReadingUsefulChunkResult = {
  chunk: string;
  register: string;
  example: string;
};

export type ReadingEvaluationResult = {
  id: number;
  summaryFidelity: SummaryFidelity;
  responseRelevance: ResponseRelevance;
  priorityIssues: ReadingPriorityIssueResult[];
  usefulChunks: ReadingUsefulChunkResult[];
};

export type ReadingSessionAttempt = {
  id: number;
  textId: string;
  status: ReadingSessionStatus;
  createdAt: number;
};

export type ReadingComprehensionResult = {
  isCorrect: boolean;
};

export type ReadingSessionDetail = {
  id: number;
  textId: string;
  status: ReadingSessionStatus;
  comprehensionCorrect?: boolean;
  selectedChunkIds: number[];
  summaryText?: string;
  responseText?: string;
  createdAt: number;
  evaluation?: ReadingEvaluationResult;
};

export type StartReadingSessionRequest = {
  textId: string;
};

export type SubmitReadingComprehensionAnswerRequest = {
  attemptId: number;
  correctOptionIndex: number;
  selectedOptionIndex: number;
};

export type ReadingChunkCandidateInput = {
  chunkType: LexicalChunkType;
  text: string;
  meaning: string;
  register: string;
};

export type AcceptReadingChunksRequest = {
  attemptId: number;
  targetLevel: CefrLevel;
  chunks: ReadingChunkCandidateInput[];
};

export type SubmitReadingProductionRequest = {
  attemptId: number;
  readingTextBody: string;
  summaryPrompt: string;
  responsePrompt: string;
  summaryText: string;
  responseText: string;
};

export function readingTextTypeLabel(textType: ReadingTextType): string {
  switch (textType) {
    case "professional_email":
      return "Professional email";
    case "technical_article":
      return "Technical article";
    case "product_update":
      return "Product update";
    case "opinion_piece":
      return "Opinion piece";
    case "workplace_scenario":
      return "Workplace scenario";
    case "short_narrative":
      return "Short narrative";
  }
}
