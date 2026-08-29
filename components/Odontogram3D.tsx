'use client';
import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ToothState, Treatment } from '@/lib/types';

interface Odontogram3DProps {
  patientId?: string;
  teeth?: Record<number, ToothState>;
  treatments?: Treatment[];
  onTeethChange?: (num: number, patch: Partial<ToothState>) => Promise<void> | void;
  onAddTreatment?: (data: Record<string, unknown>) => Promise<void> | void;
  readOnly?: boolean;
}

interface ArchProps {
  teeth: Record<number, ToothState>;
  treatments: Treatment[];
  selectedTooth: number | null;
  onSelect: (num: number) => void;
}

const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

const COND_COLORS: Record<string, string> = {
  healthy: '#00A3BF',
  caries: '#DE350B',
  missing: '#5E6C84',
  root_canal: '#00875A',
  filling: '#0052CC',
  crown: '#5243AA',
};

function getArchPosition(num: number) {
  const idx = UPPER.includes(num) ? UPPER.indexOf(num) : LOWER.indexOf(num);
  const isUpper = UPPER.includes(num);
  const total = 16;
  const progress = idx / (total - 1);
  const angle = (progress - 0.5) * Math.PI * 1.1;
  const radius = isUpper ? 4.8 : 4.5;
  const x = Math.sin(angle) * radius;
  const z = -(Math.cos(angle) * radius);
  const y = isUpper ? 1.2 : -1.2;
  const rotY = -angle;
  return { position: [x, y, z] as [number, number, number], rotation: rotY };
}

function createToothGeometry() {
  const shape = new THREE.Shape();
  const w = 0.5;
  const h = 0.7;

  shape.moveTo(-w * 0.45, -h * 0.5);
  shape.quadraticCurveTo(-w * 0.5, -h * 0.2, -w * 0.35, h * 0.1);
  shape.quadraticCurveTo(-w * 0.3, h * 0.35, -w * 0.15, h * 0.45);
  shape.quadraticCurveTo(0, h * 0.5, w * 0.15, h * 0.45);
  shape.quadraticCurveTo(w * 0.3, h * 0.35, w * 0.35, h * 0.1);
  shape.quadraticCurveTo(w * 0.5, -h * 0.2, w * 0.45, -h * 0.5);

  const extrudeSettings = {
    depth: 0.35,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.04,
    bevelSegments: 6,
  };
  return new THREE.ExtrudeGeometry(shape, extrudeSettings);
}

function ToothShape({ condition, selected, onClick }: { condition: string; selected: boolean; onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = COND_COLORS[condition] || '#97A0AF';
  const isMissing = condition === 'missing';

  const geo = useMemo(() => createToothGeometry(), []);

  useFrame((state) => {
    if (meshRef.current && selected) {
      meshRef.current.position.y += Math.sin(state.clock.elapsedTime * 3) * 0.001;
    }
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <mesh> is a react-three-fiber 3D scene node, not a DOM element — it has no keyboard/focus semantics to add.
    <mesh
      ref={meshRef}
      geometry={geo}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      scale={isMissing ? 0.92 : 1}
      castShadow
    >
      <meshStandardMaterial
        color={isMissing ? '#E8E8E8' : color}
        transparent
        opacity={isMissing ? 0.3 : condition === 'healthy' ? 0.35 : 0.85}
        roughness={0.4}
        metalness={0.1}
        emissive={selected ? color : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
      />
    </mesh>
  );
}

function ToothNumber({ num, position }: { num: number; position: [number, number, number] }) {
  return (
    <Text
      position={[position[0], position[1] - 0.8, position[2]]}
      fontSize={0.2}
      color="#97A0AF"
      anchorX="center"
      anchorY="middle"
    >
      {num}
    </Text>
  );
}

function DentalArch({ teeth, treatments, selectedTooth, onSelect }: ArchProps) {
  const allNums = [...UPPER, ...LOWER];

  return (
    <group>
      {allNums.map((num) => {
        const { position, rotation } = getArchPosition(num);
        const toothData = teeth[num] || ({} as Partial<ToothState>);
        const condition = toothData.condition || 'healthy';
        const activeTreatments = (treatments || []).filter((t) => t.tooth_num === num && t.status !== 'completed');

        return (
          <group key={num} position={position} rotation={[0, rotation, 0]}>
            <ToothShape condition={condition} selected={selectedTooth === num} onClick={() => onSelect(num)} />
            {activeTreatments.length > 0 && (
              <mesh position={[0, 0.6, 0]}>
                <sphereGeometry args={[0.08, 16, 16]} />
                <meshStandardMaterial color="#FF8B00" emissive="#FF8B00" emissiveIntensity={0.5} />
              </mesh>
            )}
            <ToothNumber num={num} position={[0, -0.55, 0]} />
          </group>
        );
      })}
    </group>
  );
}

function Scene({ teeth, treatments, selectedTooth, onSelect }: ArchProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
      <directionalLight position={[-3, 4, -3]} intensity={0.4} />
      <pointLight position={[0, 6, 0]} intensity={0.3} />
      <DentalArch teeth={teeth} treatments={treatments} selectedTooth={selectedTooth} onSelect={onSelect} />
      <OrbitControls
        enablePan={false}
        minPolarAngle={0.3}
        maxPolarAngle={2.5}
        minDistance={3}
        maxDistance={12}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </>
  );
}

export default function Odontogram3D({ teeth = {}, treatments = [] }: Odontogram3DProps) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div
      style={{
        width: '100%',
        height: 520,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #DFE1E6',
        position: 'relative',
      }}
    >
      <Canvas camera={{ position: [0, 2, 8], fov: 40 }} shadows onPointerMissed={() => setSelected(null)}>
        <Scene teeth={teeth} treatments={treatments} selectedTooth={selected} onSelect={setSelected} />
      </Canvas>
      {selected && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'white',
            borderRadius: 8,
            padding: '8px 16px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            fontSize: 13,
            fontWeight: 600,
            color: '#172B4D',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          Tooth #{selected} — {COND_COLORS[teeth[selected]?.condition] || 'Healthy'}
          <span style={{ fontSize: 11, color: '#97A0AF', fontWeight: 400 }}>Select in the panel below to modify</span>
        </div>
      )}
    </div>
  );
}
