import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import type { JourneyCheckpoint } from "../types/journey";
import type { Vector3Like } from "./pathLayout";

const PRIMARY_COLOR = "#016a71";
const NEEDS_REVIEW_COLOR = "#8a5a12";
const POLE_COLOR = "#c9bfa8";

export function CheckpointMarker({
  checkpoint,
  position,
  onSelect,
}: {
  checkpoint: JourneyCheckpoint;
  position: Vector3Like;
  onSelect: (checkpoint: JourneyCheckpoint) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "auto";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [hovered]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const bob = Math.sin(state.clock.elapsedTime * 2 + position.z) * 0.06;
    mesh.position.y = 0.9 + bob;
    const targetScale = hovered ? 1.3 : 1;
    const nextScale = mesh.scale.x + (targetScale - mesh.scale.x) * 0.2;
    mesh.scale.setScalar(nextScale);
  });

  const color = checkpoint.needsReview ? NEEDS_REVIEW_COLOR : PRIMARY_COLOR;

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.8, 6]} />
        <meshStandardMaterial color={POLE_COLOR} flatShading />
      </mesh>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(checkpoint);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          setHovered(false);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        ref={meshRef}
      >
        <octahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
    </group>
  );
}
