// Flat low-poly ground with a handful of scattered trees for set dressing.
// Colors mirror the "Parchment Coach" theme tokens in src/index.css —
// three.js materials need literal values, not CSS custom properties.
const GROUND_COLOR = "#dcd3bd";
const TRUNK_COLOR = "#6b4a2f";
const FOLIAGE_COLOR = "#3f6b52";

const TREE_POSITIONS: [number, number, number][] = [
  [-8, 0, -6],
  [7, 0, -14],
  [-6, 0, -22],
  [8, 0, -30],
  [-9, 0, -40],
  [6, 0, -48],
];

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 1.2, 6]} />
        <meshStandardMaterial color={TRUNK_COLOR} flatShading />
      </mesh>
      <mesh castShadow position={[0, 1.7, 0]}>
        <coneGeometry args={[0.9, 1.8, 6]} />
        <meshStandardMaterial color={FOLIAGE_COLOR} flatShading />
      </mesh>
    </group>
  );
}

export function Terrain({ length }: { length: number }) {
  return (
    <group>
      <mesh position={[0, -0.05, -length / 2]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, length + 24]} />
        <meshStandardMaterial color={GROUND_COLOR} flatShading />
      </mesh>
      {TREE_POSITIONS.map((position, index) => (
        <Tree key={index} position={position} />
      ))}
    </group>
  );
}
