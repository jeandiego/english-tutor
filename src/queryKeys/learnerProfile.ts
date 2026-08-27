export const learnerProfileKeys = {
  all: ["learnerProfile"] as const,
  detail: () => [...learnerProfileKeys.all, "detail"] as const,
};
