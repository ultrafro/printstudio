"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import type { ImportedModel, ShapeDefinition } from "@/lib/studio-types";
import {
  buildFinalMesh,
  createImportedMesh,
  createMeshForShape,
} from "@/lib/studio-model";

export function StudioCanvas({
  project,
  selectedShapeId,
  agentConnected,
  viewMode,
}: {
  project: {
    shapes: ShapeDefinition[];
    importedModel: ImportedModel | null;
  };
  selectedShapeId: string | null;
  agentConnected: boolean;
  viewMode: "final" | "assembly";
}) {
  const finalMesh = useMemo(
    () => (viewMode === "final" ? buildFinalMesh(project) : null),
    [project, viewMode],
  );
  const ghostMeshes = useMemo(
    () => project.shapes.map((shape) => createMeshForShape(shape)),
    [project.shapes],
  );
  const importedMesh = useMemo(
    () => (project.importedModel ? createImportedMesh(project.importedModel) : null),
    [project.importedModel],
  );

  return (
    <Canvas
      camera={{ position: [180, 150, 180], fov: 36 }}
      dpr={[1, 1.6]}
      shadows
    >
      <color attach="background" args={[agentConnected ? "#dff5ee" : "#f0ece2"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[180, 220, 140]} intensity={2.5} castShadow />
      <directionalLight position={[-120, -140, 80]} intensity={0.8} />
      <gridHelper args={[320, 32, "#0f766e", "#cbd5e1"]} position={[0, 0, 0]} />
      <mesh position={[0, -1.5, 0]} receiveShadow>
        <boxGeometry args={[256, 3, 256]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      {viewMode === "final" && finalMesh ? (
        <primitive object={finalMesh} castShadow receiveShadow>
          <meshStandardMaterial
            attach="material"
            color={agentConnected ? "#059669" : "#155e75"}
            metalness={0.08}
            roughness={0.36}
          />
        </primitive>
      ) : null}
      {viewMode === "assembly"
        ? ghostMeshes.map((mesh) => (
            <primitive key={mesh.uuid} object={mesh}>
              <meshStandardMaterial
                attach="material"
                color={mesh.name === selectedShapeId ? "#2563eb" : "#94a3b8"}
                transparent
                opacity={mesh.name === selectedShapeId ? 0.4 : 0.16}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
            </primitive>
          ))
        : null}
      {viewMode === "assembly" && importedMesh ? (
        <primitive object={importedMesh}>
          <meshStandardMaterial
            attach="material"
            color="#64748b"
            transparent
            opacity={0.24}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </primitive>
      ) : null}
      <OrbitControls makeDefault minDistance={90} maxDistance={480} />
    </Canvas>
  );
}
