import { describe, expect, it } from "vitest";
import { computeCheckpointWaypoints } from "./pathLayout";
import type { JourneyCheckpoint } from "../types/journey";

function checkpoint(id: string): JourneyCheckpoint {
  return {
    id,
    kind: "conversation",
    refId: 1,
    createdAt: 0,
    headline: id,
    needsReview: false,
  };
}

describe("computeCheckpointWaypoints", () => {
  it("returns one waypoint per checkpoint, in the same order", () => {
    const checkpoints = [checkpoint("a"), checkpoint("b"), checkpoint("c")];
    const waypoints = computeCheckpointWaypoints(checkpoints);
    expect(waypoints.map((waypoint) => waypoint.checkpointId)).toEqual(["a", "b", "c"]);
  });

  it("places the first checkpoint at the origin and steps each later one further along z", () => {
    const waypoints = computeCheckpointWaypoints([checkpoint("a"), checkpoint("b")]);
    expect(waypoints[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(waypoints[1].position.z).toBeLessThan(waypoints[0].position.z);
  });

  it("is deterministic across calls with the same input length", () => {
    const checkpoints = [checkpoint("a"), checkpoint("b"), checkpoint("c"), checkpoint("d")];
    expect(computeCheckpointWaypoints(checkpoints)).toEqual(computeCheckpointWaypoints(checkpoints));
  });

  it("returns an empty list for no checkpoints", () => {
    expect(computeCheckpointWaypoints([])).toEqual([]);
  });
});
