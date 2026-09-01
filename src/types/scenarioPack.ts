import { z } from "zod";
import type { CefrLevel } from "./assessment";
import type { LexicalChunkType } from "./chunk";
import type { ReviewItemType } from "./review";

const CEFR_LEVELS: [CefrLevel, ...CefrLevel[]] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const REVIEW_ITEM_TYPES: [ReviewItemType, ...ReviewItemType[]] = [
  "grammar_pattern",
  "vocabulary",
  "phrase",
  "pronunciation_target",
  "conversation_strategy",
];
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

const nonEmptyString = z.string().trim().min(1);
const nonEmptyStringArray = z.array(nonEmptyString).min(1);

export const scenarioPackVariationSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  extraPrompt: nonEmptyString,
});

export const scenarioPackReviewItemSchema = z.object({
  content: nonEmptyString,
  type: z.enum(REVIEW_ITEM_TYPES),
});

export const scenarioPackVocabularyItemSchema = z.object({
  chunkType: z.enum(LEXICAL_CHUNK_TYPES),
  text: nonEmptyString,
  meaning: nonEmptyString,
  register: nonEmptyString,
  targetLevel: z.enum(CEFR_LEVELS),
  domain: nonEmptyString.optional(),
  examples: z.array(nonEmptyString).optional(),
  commonError: nonEmptyString.optional(),
});

export const scenarioPackSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case (e.g. daily-standup)"),
  title: nonEmptyString,
  shortDescription: nonEmptyString,
  recommendedLevels: z.array(z.enum(CEFR_LEVELS)).min(1),
  communicativeGoals: nonEmptyStringArray,
  vocabulary: nonEmptyStringArray,
  grammarTargets: nonEmptyStringArray,
  conversationMoves: nonEmptyStringArray,
  warmUpPrompts: nonEmptyStringArray,
  rolePlayPrompts: nonEmptyStringArray,
  challengePrompts: nonEmptyStringArray,
  successCriteria: nonEmptyStringArray,
  suggestedReviewItems: z.array(scenarioPackReviewItemSchema).min(1),
  focusPlaceholder: nonEmptyString,
  variations: z.array(scenarioPackVariationSchema).optional(),
  targetVocabulary: z.array(scenarioPackVocabularyItemSchema).optional(),
});

export type ScenarioPackVariation = z.infer<typeof scenarioPackVariationSchema>;

export type ScenarioPack = z.infer<typeof scenarioPackSchema>;

/** The minimal shape the session engine depends on — keeps useSessionRun
 * decoupled from the ScenarioPack data format. */
export type SessionSource = {
  id: string;
  label: string;
  systemPrompt: string;
  focusPlaceholder: string;
};

export function scenarioPackSystemPrompt(pack: ScenarioPack): string {
  const sections = [
    `Communicative goals: ${pack.communicativeGoals.join("; ")}.`,
    `Stay in character and follow these conversation moves: ${pack.conversationMoves.join("; ")}.`,
    `Where natural, use vocabulary such as: ${pack.vocabulary.join(", ")}.`,
  ];
  return sections.join("\n");
}

export function toSessionSource(pack: ScenarioPack, variationId?: string): SessionSource {
  const variation = pack.variations?.find((candidate) => candidate.id === variationId);
  const systemPrompt = variation
    ? `${scenarioPackSystemPrompt(pack)}\n\n${variation.extraPrompt}`
    : scenarioPackSystemPrompt(pack);

  return {
    id: pack.id,
    label: variation ? `${pack.title} — ${variation.title}` : pack.title,
    systemPrompt,
    focusPlaceholder: pack.focusPlaceholder,
  };
}
