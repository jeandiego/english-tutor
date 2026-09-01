export const readingKeys = {
  all: ["reading"] as const,
  detail: (attemptId: number) => [...readingKeys.all, "detail", attemptId] as const,
};
