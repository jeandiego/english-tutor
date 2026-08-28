export const reviewKeys = {
  all: ["review"] as const,
  due: () => [...reviewKeys.all, "due"] as const,
  recentEvents: (limit: number) => [...reviewKeys.all, "recentEvents", limit] as const,
};
