import type { JourneyCheckpoint } from "../types/journey";

export type Vector3Like = { x: number; y: number; z: number };

export type CheckpointWaypoint = {
  checkpointId: string;
  position: Vector3Like;
};

// Each checkpoint steps further "into" the scene along Z, weaving side to
// side along X on a fixed sine curve — deterministic from index alone, so
// the layout is stable across reloads without persisting any positions.
const STEP_Z = 4;
const AMPLITUDE_X = 6;
const CHECKPOINTS_PER_WAVE = 6;

export function computeCheckpointWaypoints(checkpoints: JourneyCheckpoint[]): CheckpointWaypoint[] {
  return checkpoints.map((checkpoint, index) => ({
    checkpointId: checkpoint.id,
    position: {
      x: Math.sin((index / CHECKPOINTS_PER_WAVE) * Math.PI * 2) * AMPLITUDE_X,
      y: 0,
      // `|| 0` normalizes -0 (from -0 * STEP_Z at index 0) to 0.
      z: -index * STEP_Z || 0,
    },
  }));
}
