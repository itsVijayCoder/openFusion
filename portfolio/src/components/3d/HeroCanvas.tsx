"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Text3D, Center, Environment } from "@react-three/drei";
import * as THREE from "three";

// Main canvas component
function HeroCanvas() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 28], fov: 50 }}
      style={{ background: "transparent" }}
      gl={{ alpha: true, antialias: true }}
    >
      < ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 15]} angle={0.15} penumbra={1} intensity={3} color="#3fa1f8" />
      <pointLight position={[-5, 5, 10]} intensity={2} color="#c084fc" />

      <group>
        <RotatingIcosahedron />
        <InnerWireframe />
        <ParticleField />
        <FloatingRings />
      </group>

      <Environment blur={0.75} preset="city" />
    </Canvas>
  );
}

// Main rotating icosahedron - central hero shape
function RotatingIcosahedron() {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!meshRef.current || !groupRef.current) return;

    const t = state.clock.getElapsedTime();

    // Continuous rotation
    meshRef.current.rotation.x = Math.sin(t * 0.3) * 0.3;
    meshRef.current.rotation.y = t * 0.25;
    meshRef.current.rotation.z = Math.cos(t * 0.2) * 0.2;

    // Subtle breathing scale
    const scale = 1 + Math.sin(t * 0.8) * 0.05;
    groupRef.current.scale.setScalar(scale);

    // Gentle float motion
    groupRef.current.position.y = Math.sin(t * 0.6) * 0.5;
  });

  return (
    <group ref={groupRef}>
      <Float speed={2} rotationIntensity={0.3} floatIntensity={0.5}>
        <mesh ref={meshRef}>
          <icosahedronGeometry args={[6, 1]} />
          <meshPhysicalMaterial
            color="#3fa1f8"
            metalness={0.8}
            roughness={0.15}
            transparent
            opacity={0.12}
            transmission={0.6}
            thickness={2}
            clearcoat={1}
            clearcoatRoughness={0.1}
          />
        </mesh>
        {/* Wireframe overlay */}
        <mesh>
          <icosahedronGeometry args={[6.1, 1]} />
          <meshBasicMaterial
            color="#3fa1f8"
            wireframe
            transparent
            opacity={0.08}
          />
        </mesh>
      </Float>
    </group>
  );
}

// Inner geometric wireframe
function InnerWireframe() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    meshRef.current.rotation.x = -t * 0.15;
    meshRef.current.rotation.y = t * 0.2;

    const scale = 0.6 + Math.sin(t * 0.7) * 0.1;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[3, 0]} />
      <meshBasicMaterial
        color="#c084fc"
        wireframe
        transparent
        opacity={0.15}
      />
    </mesh>
  );
}

// Ambient particle field
function ParticleField() {
  const pointsRef = useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.02;
  });

  const particleCount = 800;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    const radius = 8 + Math.random() * 25;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = radius * Math.cos(phi);

    // Mix of blue and purple
    const isBlue = Math.random() > 0.4;
    colors[i3] = isBlue ? 0.247 : 0.753;
    colors[i3 + 1] = isBlue ? 0.631 : 0.518;
    colors[i3 + 2] = isBlue ? 0.973 : 0.988;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={0.08}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Floating orbital rings
function FloatingRings() {
  const rings = [
    { radius: 10, color: "#3fa1f8", speed: 0.3 },
    { radius: 12, color: "#c084fc", speed: -0.2 },
    { radius: 14, color: "#69c9f9", speed: 0.15 },
  ];

  return (
    <group>
      {rings.map((ring, index) => (
        <FloatingRing key={index} {...ring} />
      ))}
    </group>
  );
}

function FloatingRing({ radius, color, speed }: { radius: number; color: string; speed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();

    meshRef.current.rotation.x = Math.sin(t * 0.5) * 0.5;
    meshRef.current.rotation.y = t * speed;
    meshRef.current.rotation.z = Math.cos(t * 0.3) * 0.3;
  });

  return (
    <mesh ref={meshRef}>
      <torusGeometry args={[radius, 0.03, 8, 128]} />
      <meshBasicMaterial color={color} transparent opacity={0.2} />
    </mesh>
  );
}

export default HeroCanvas;
