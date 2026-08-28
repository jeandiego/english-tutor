export const scenarioPackKeys = {
  all: ["scenarioPacks"] as const,
  favorites: () => [...scenarioPackKeys.all, "favorites"] as const,
};
