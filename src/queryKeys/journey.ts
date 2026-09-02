export const journeyKeys = {
  all: ["journey"] as const,
  checkpoints: (limit?: number) => [...journeyKeys.all, "checkpoints", limit] as const,
};
