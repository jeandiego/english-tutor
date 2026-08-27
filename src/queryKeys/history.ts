export const historyKeys = {
  all: ["history"] as const,
  session: () => [...historyKeys.all, "session"] as const,
  recent: (limit: number) => [...historyKeys.all, "recent", limit] as const,
};
