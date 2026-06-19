"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

export default function SkillParticles() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 20], fov: 60 }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.3} />
      <group>
        <SkillOrbs />
        <SkillParticles />
      </group>
    </Canvas>
  );
}

function SkillOrbs() {
  const orbitGroupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!orbitGroupRef.current) return;
    orbitGroupRef.current.rotation.y = state.clock.getElapsedTime() * 0.05;
  });

  const orbColors = [
    "0x3fa1f8", "0x61da55", "0xF7DF1E", "0x3776AB",
    "0x06B6D4", "0x2496ED", "0xFF9900", "0xE10098",
  ];

  return (
    <group ref={orbitGroupRef}>
      {orbColors.map((color, i) => {
        const radius = 5 + i * 1.2;
        const angle = (i / orbColors.length) * Math.PI * 2;
        return (
          <FloatingOrb key={i} radius={radius} angle={angle} color={color} speed={0.1 + i * 0.02} />
        );
      })}
    </group>
  );
}

function FloatingOrb({ radius, angle, color, speed }: { radius: number; angle: number; color: string; speed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    meshRef.current.position.x = Math.cos(angle + t * speed) * radius;
    meshRef.current.position.z = Math.sin(angle + t * speed) * radius;
    meshRef.current.position.y = Math.sin(t * 0.8 + angle) * 1.5;
    meshRef.current.rotation.y = t * speed * 2;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.3, 16, 16]} />
      <meshPhysicalMaterial
        color={Number(color)}
        emissive={Number(color)}
        emissiveIntensity={0.4}
        metalness={0.5}
        roughness={0.2}
      />
    </mesh>
  );
}

function SkillParticles() {
  const pointsRef = useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.1;
  });

  const count = 500;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const radius = 3 + Math.random() * 12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = radius * Math.cos(phi);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={0.05}
        color="#818cf8"
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
