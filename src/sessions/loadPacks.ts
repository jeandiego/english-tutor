import { scenarioPackSchema, type ScenarioPack } from "../types/scenarioPack";

export type PackLoadError = {
  file: string;
  message: string;
};

export type PackCatalog = {
  packs: ScenarioPack[];
  errors: PackLoadError[];
};

const packModules = import.meta.glob("./packs/*.json", { eager: true }) as Record<
  string,
  { default: unknown }
>;

function fileBaseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function loadPacksFrom(modules: Record<string, { default: unknown }>): PackCatalog {
  const packs: ScenarioPack[] = [];
  const errors: PackLoadError[] = [];
  const seenIds = new Set<string>();

  for (const [path, module] of Object.entries(modules)) {
    const file = fileBaseName(path);
    const result = scenarioPackSchema.safeParse(module.default);

    if (!result.success) {
      errors.push({ file, message: result.error.issues.map((issue) => issue.message).join("; ") });
      continue;
    }

    if (seenIds.has(result.data.id)) {
      errors.push({ file, message: `Duplicate pack id "${result.data.id}".` });
      continue;
    }

    seenIds.add(result.data.id);
    packs.push(result.data);
  }

  packs.sort((a, b) => a.title.localeCompare(b.title));

  return { packs, errors };
}

export function loadPacks(): PackCatalog {
  return loadPacksFrom(packModules);
}

export function findScenarioPack(
  packs: ScenarioPack[],
  id: string | undefined,
): ScenarioPack | undefined {
  return id === undefined ? undefined : packs.find((pack) => pack.id === id);
}

export const PACK_CATALOG: PackCatalog = loadPacks();

export function scenarioLabelFor(mode: string | undefined): string {
  return findScenarioPack(PACK_CATALOG.packs, mode)?.title ?? "Free conversation";
}
