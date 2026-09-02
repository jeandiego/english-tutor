export const assessmentKeys = {
  all: ["assessment"] as const,
  latest: () => [...assessmentKeys.all, "latest"] as const,
  detail: (assessmentId: number) => [...assessmentKeys.all, "detail", assessmentId] as const,
};
