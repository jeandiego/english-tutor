export type DurationPresetId = "quick" | "standard" | "extended";

export type DurationPreset = {
  id: DurationPresetId;
  label: string;
  approxMinutes: string;
  targetTurns: number;
};

export const DURATION_PRESETS: DurationPreset[] = [
  { id: "quick", label: "Quick", approxMinutes: "~3 min", targetTurns: 4 },
  { id: "standard", label: "Standard", approxMinutes: "~6 min", targetTurns: 6 },
  { id: "extended", label: "Extended", approxMinutes: "~10 min", targetTurns: 9 },
];

export function findDurationPreset(id: DurationPresetId): DurationPreset {
  return DURATION_PRESETS.find((preset) => preset.id === id) ?? DURATION_PRESETS[1];
}
