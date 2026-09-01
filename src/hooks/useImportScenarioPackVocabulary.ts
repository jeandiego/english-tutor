import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { importScenarioPackVocabulary as defaultImportScenarioPackVocabulary } from "../native/chunk";
import { chunkKeys } from "../queryKeys/chunk";
import type { ImportScenarioPackVocabularyRequest, LexicalChunk } from "../types/chunk";
import type { ScenarioPack } from "../types/scenarioPack";

type ImportVocabulary = (
  request: ImportScenarioPackVocabularyRequest,
) => Promise<LexicalChunk[]>;

/**
 * Imports a scenario pack's manually-authored `targetVocabulary` as
 * `LexicalChunk` candidates. Safe to call repeatedly for the same pack —
 * `create_chunk_candidate`'s `normalized_text` dedup already makes it a
 * no-op past the first successful import — so callers don't need to track
 * "already imported" themselves.
 */
export function useImportScenarioPackVocabulary(
  importVocabulary: ImportVocabulary = defaultImportScenarioPackVocabulary,
) {
  const queryClient = useQueryClient();
  const importVocabularyRef = useRef(importVocabulary);
  importVocabularyRef.current = importVocabulary;

  return useCallback(
    async (pack: ScenarioPack) => {
      if (!pack.targetVocabulary || pack.targetVocabulary.length === 0) {
        return;
      }

      try {
        await importVocabularyRef.current({
          packId: pack.id,
          items: pack.targetVocabulary.map((item) => ({
            ...item,
            examples: item.examples ?? [],
          })),
        });
        void queryClient.invalidateQueries({ queryKey: chunkKeys.all });
      } catch {
        // A chunk-import failure must never block favoriting or starting a
        // session — the primary action has already succeeded by this point.
      }
    },
    [queryClient],
  );
}
