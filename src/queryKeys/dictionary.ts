import type { DictionaryContextTag } from "../types/dictionary";

export const dictionaryKeys = {
  all: ["dictionary"] as const,
  list: (contextTag: DictionaryContextTag | undefined, includeExcluded: boolean) =>
    [...dictionaryKeys.all, "list", contextTag ?? "all", includeExcluded] as const,
};
