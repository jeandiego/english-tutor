import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { JourneyCheckpoint } from "../types/journey";
import { Avatar } from "./Avatar";
import { CheckpointMarker } from "./CheckpointMarker";
import { computeCheckpointWaypoints } from "./pathLayout";
import { Terrain } from "./Terrain";

const SKY_COLOR = "#faf8f5";
const MIN_PATH_LENGTH = 10;

export function JourneyScene({
  checkpoints,
  unlockedAccessories,
  onSelectCheckpoint,
}: {
  checkpoints: JourneyCheckpoint[];
  unlockedAccessories: string[];
  onSelectCheckpoint: (checkpoint: JourneyCheckpoint) => void;
}) {
  const waypoints = computeCheckpointWaypoints(checkpoints);
  const lastPosition = waypoints[waypoints.length - 1]?.position ?? { x: 0, y: 0, z: 0 };
  const pathLength = Math.max(...waypoints.map((waypoint) => -waypoint.position.z), MIN_PATH_LENGTH);

  return (
    <Canvas camera={{ position: [10, 9, 10], fov: 45 }} shadows>
      <color args={[SKY_COLOR]} attach="background" />
      <ambientLight intensity={0.7} />
      <directionalLight castShadow intensity={1.1} position={[8, 12, 6]} />
      <Terrain length={pathLength} />
      {waypoints.map(({ checkpointId, position }) => {
        const checkpoint = checkpoints.find((item) => item.id === checkpointId);
        if (!checkpoint) return null;
        return (
          <CheckpointMarker
            checkpoint={checkpoint}
            key={checkpointId}
            onSelect={onSelectCheckpoint}
            position={position}
          />
        );
      })}
      <Avatar position={lastPosition} unlockedAccessories={unlockedAccessories} />
      <OrbitControls
        maxDistance={30}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={6}
        minPolarAngle={Math.PI / 6}
        target={[lastPosition.x, 1, lastPosition.z]}
      />
    </Canvas>
  );
}
