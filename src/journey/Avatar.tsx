import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { Vector3Like } from "./pathLayout";

const SKIN_COLOR = "#e8b98a";
const BODY_COLOR = "#016a71";
const BACKPACK_COLOR = "#8a5a12";
const CAPE_COLOR = "#3f6b52";
const CROWN_COLOR = "#d4af37";
const PAGE_COLOR = "#dcd3bd";
const BOOK_COLOR = "#6b4a2f";

// Cosmetic-only: every entry is a small mesh conditionally rendered when its
// id shows up in `unlockedAccessories` (see journey/progression.ts). There
// is no equipment/inventory system behind this — just a visual reflection
// of existing stats.
const ACCESSORY_MESHES: Record<string, ReactNode> = {
  backpack: (
    <mesh key="backpack" position={[0, 1.1, -0.22]}>
      <boxGeometry args={[0.32, 0.4, 0.18]} />
      <meshStandardMaterial color={BACKPACK_COLOR} flatShading />
    </mesh>
  ),
  cape: (
    <mesh key="cape" position={[0, 0.9, -0.24]}>
      <boxGeometry args={[0.5, 0.7, 0.04]} />
      <meshStandardMaterial color={CAPE_COLOR} flatShading />
    </mesh>
  ),
  crown: (
    <mesh key="crown" position={[0, 1.72, 0]}>
      <coneGeometry args={[0.22, 0.18, 5]} />
      <meshStandardMaterial color={CROWN_COLOR} flatShading />
    </mesh>
  ),
  badge_b1: (
    <mesh key="badge_b1" position={[0.22, 1.15, 0.2]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshStandardMaterial color={BODY_COLOR} flatShading />
    </mesh>
  ),
  badge_c1: (
    <mesh key="badge_c1" position={[-0.22, 1.15, 0.2]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshStandardMaterial color={CROWN_COLOR} flatShading />
    </mesh>
  ),
  scroll: (
    <mesh key="scroll" position={[0.3, 0.9, 0.1]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.05, 0.05, 0.35, 6]} />
      <meshStandardMaterial color={PAGE_COLOR} flatShading />
    </mesh>
  ),
  tome: (
    <mesh key="tome" position={[-0.3, 0.9, 0.1]}>
      <boxGeometry args={[0.16, 0.22, 0.06]} />
      <meshStandardMaterial color={BOOK_COLOR} flatShading />
    </mesh>
  ),
};

export function Avatar({
  position,
  unlockedAccessories,
}: {
  position: Vector3Like;
  unlockedAccessories: string[];
}) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    group.position.y = position.y + Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
  });

  return (
    <group position={[position.x, position.y, position.z]} ref={groupRef}>
      <mesh position={[0, 0.45, 0]}>
        <capsuleGeometry args={[0.22, 0.5, 4, 8]} />
        <meshStandardMaterial color={BODY_COLOR} flatShading />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[0.22, 10, 10]} />
        <meshStandardMaterial color={SKIN_COLOR} flatShading />
      </mesh>
      {unlockedAccessories.map((accessory) => ACCESSORY_MESHES[accessory] ?? null)}
    </group>
  );
}
