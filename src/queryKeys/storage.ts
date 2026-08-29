export const storageKeys = {
  all: ["storage"] as const,
  info: () => [...storageKeys.all, "info"] as const,
};
