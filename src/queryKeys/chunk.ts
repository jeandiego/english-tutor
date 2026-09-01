export const chunkKeys = {
  all: ["chunk"] as const,
  active: (limit: number) => [...chunkKeys.all, "active", limit] as const,
};
