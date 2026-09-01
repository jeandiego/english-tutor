export const writingKeys = {
  all: ["writing"] as const,
  taskTypes: () => [...writingKeys.all, "taskTypes"] as const,
  detail: (writingTaskId: number) => [...writingKeys.all, "detail", writingTaskId] as const,
  recent: (limit: number) => [...writingKeys.all, "recent", limit] as const,
};
