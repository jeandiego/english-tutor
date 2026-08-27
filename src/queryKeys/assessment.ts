export const assessmentKeys = {
  all: ["assessment"] as const,
  latest: () => [...assessmentKeys.all, "latest"] as const,
};
