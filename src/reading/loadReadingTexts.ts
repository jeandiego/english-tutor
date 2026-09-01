import { readingTextSchema, type ReadingText } from "../types/reading";

export type ReadingTextLoadError = {
  file: string;
  message: string;
};

export type ReadingTextCatalog = {
  texts: ReadingText[];
  errors: ReadingTextLoadError[];
};

const textModules = import.meta.glob("./texts/*.json", { eager: true }) as Record<
  string,
  { default: unknown }
>;

function fileBaseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function loadReadingTextsFrom(modules: Record<string, { default: unknown }>): ReadingTextCatalog {
  const texts: ReadingText[] = [];
  const errors: ReadingTextLoadError[] = [];
  const seenIds = new Set<string>();

  for (const [path, module] of Object.entries(modules)) {
    const file = fileBaseName(path);
    const result = readingTextSchema.safeParse(module.default);

    if (!result.success) {
      errors.push({ file, message: result.error.issues.map((issue) => issue.message).join("; ") });
      continue;
    }

    if (seenIds.has(result.data.id)) {
      errors.push({ file, message: `Duplicate reading text id "${result.data.id}".` });
      continue;
    }

    seenIds.add(result.data.id);
    texts.push(result.data);
  }

  texts.sort((a, b) => a.title.localeCompare(b.title));

  return { texts, errors };
}

export function loadReadingTexts(): ReadingTextCatalog {
  return loadReadingTextsFrom(textModules);
}

export function findReadingText(texts: ReadingText[], id: string | undefined): ReadingText | undefined {
  return id === undefined ? undefined : texts.find((text) => text.id === id);
}

export const READING_TEXT_CATALOG: ReadingTextCatalog = loadReadingTexts();
