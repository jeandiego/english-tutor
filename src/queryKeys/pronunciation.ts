export const pronunciationKeys = {
  all: ["pronunciation"] as const,
  targets: (limit: number) => [...pronunciationKeys.all, "targets", limit] as const,
};
