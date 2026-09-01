import type { ReviewItemType } from "../types/review";
import type { LexicalChunkType, ProductiveStatus } from "../types/chunk";

export const CHUNK_TYPE_LABELS: Record<LexicalChunkType, string> = {
  single_word: "Single word",
  collocation: "Collocation",
  phrase: "Phrase",
  discourse_marker: "Discourse marker",
  hedging_expression: "Hedging expression",
  stance_phrase: "Stance phrase",
  register_specific_expression: "Register-specific",
  domain_specific_expression: "Domain-specific",
};

export const PRODUCTIVE_STATUS_LABELS: Record<ProductiveStatus, string> = {
  not_tried: "Not tried",
  recognized: "Recognized",
  used_with_help: "Used with help",
  used_independently: "Used independently",
  automatic: "Automatic",
};

/** Mirrors `chunk::chunk_review_item_type` on the Rust side — lets the
 * frontend call the existing `evaluate_review_attempt` command directly for
 * chunk-practice attempts without a dedicated backend judge. */
export function chunkReviewItemType(chunkType: LexicalChunkType): ReviewItemType {
  return chunkType === "single_word" || chunkType === "collocation" ? "vocabulary" : "phrase";
}
