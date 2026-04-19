import { nanoid } from "nanoid/non-secure";
import * as THREE from "three";
import { CSG } from "three-csg-ts";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type {
  ImportedModel,
  PrintAnalysis,
  PrintProfile,
  ShapeDefinition,
  StudioProject,
  Vec3,
} from "@/lib/studio-types";

const font = new FontLoader().parse(helvetikerBold);

export const BAMBU_P1S_PROFILE: PrintProfile = {
  printer: "bambu-lab-p1s",
  buildVolume: [256, 256, 256],
  nozzleMm: 0.4,
  recommendedLayerHeightMm: 0.2,
  materialNotes:
    "PLA prints fastest. PETG is safer for flexible trays that see repeated demolding.",
  supportAdvice:
    "Prefer flat-bottom orientation. Use supports only when overhangs exceed 55 degrees.",
};

export function createShape(
  primitive: ShapeDefinition["primitive"],
  partial: Partial<ShapeDefinition> = {},
): ShapeDefinition {
  const baseByPrimitive: Record<
    ShapeDefinition["primitive"],
    Pick<ShapeDefinition, "label" | "color" | "params" | "scale">
  > = {
    box: {
      label: "Block",
      color: "#0f766e",
      scale: [1, 1, 1],
      params: { width: 42, depth: 42, height: 18 },
    },
    roundedBox: {
      label: "Rounded Block",
      color: "#14532d",
      scale: [1, 1, 1],
      params: { width: 48, depth: 48, height: 22, bevelRadius: 4 },
    },
    cylinder: {
      label: "Cylinder",
      color: "#0f766e",
      scale: [1, 1, 1],
      params: { radius: 14, height: 26 },
    },
    sphere: {
      label: "Sphere",
      color: "#2563eb",
      scale: [1, 1, 1],
      params: { radius: 18 },
    },
    text: {
      label: "Text Badge",
      color: "#1d4ed8",
      scale: [1, 1, 1],
      params: { text: "PRINT", textSize: 12, textDepth: 4 },
    },
  };

  const base = baseByPrimitive[primitive];

  return {
    id: partial.id ?? nanoid(8),
    primitive,
    label: partial.label ?? base.label,
    color: partial.color ?? base.color,
    mode: partial.mode ?? "add",
    position: partial.position ?? [0, 0, 12],
    rotation: partial.rotation ?? [0, 0, 0],
    scale: partial.scale ?? base.scale,
    params: {
      ...base.params,
      ...partial.params,
    },
  };
}

export function createIceCubeTrayProject(options?: {
  theme?: string;
  rows?: number;
  columns?: number;
  cavitySizeMm?: number;
  depthMm?: number;
  wallMm?: number;
  label?: string;
}): StudioProject {
  const rows = Math.max(1, Math.round(options?.rows ?? 2));
  const columns = Math.max(1, Math.round(options?.columns ?? 3));
  const cavitySize = options?.cavitySizeMm ?? 34;
  const depth = options?.depthMm ?? 16;
  const wall = options?.wallMm ?? 4;
  const baseThickness = 5;
  const trayHeight = depth + baseThickness;
  const width = columns * cavitySize + (columns + 1) * wall + 12;
  const depthSize = rows * cavitySize + (rows + 1) * wall + 12;
  const theme = options?.theme?.trim() || "Ice Tray";
  const shapes: ShapeDefinition[] = [
    createShape("roundedBox", {
      id: "tray-shell",
      label: "Tray Shell",
      color: "#0f766e",
      position: [0, 0, trayHeight / 2],
      params: {
        width,
        depth: depthSize,
        height: trayHeight,
        bevelRadius: 6,
      },
    }),
  ];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x =
        -width / 2 +
        wall +
        cavitySize / 2 +
        6 +
        column * (cavitySize + wall);
      const y =
        -depthSize / 2 +
        wall +
        cavitySize / 2 +
        6 +
        row * (cavitySize + wall);

      shapes.push(
        createShape("box", {
          label: `Pocket ${row + 1}-${column + 1}`,
          color: "#ef4444",
          mode: "subtract",
          position: [x, y, baseThickness + depth / 2 + 1.2],
          params: {
            width: cavitySize,
            depth: cavitySize,
            height: depth + 2,
          },
        }),
      );
    }
  }

  shapes.push(
    createShape("box", {
      label: "Badge Rail",
      color: "#0f172a",
      position: [0, depthSize / 2 + 6, trayHeight - 2],
      params: {
        width: Math.max(28, Math.min(72, width * 0.5)),
        depth: 8,
        height: 3,
      },
    }),
  );

  return {
    name: `${theme} Tray`,
    brief:
      "A rounded ice cube tray designed for fast iteration, live agent verification, and clean STL export.",
    printerProfile: BAMBU_P1S_PROFILE,
    shapes,
    selectedShapeId: "tray-shell",
    importedModel: null,
  };
}

export function createStarterProject(): StudioProject {
  return createIceCubeTrayProject({
    theme: "Agent-ready Frost",
    label: "FROST",
  });
}

function createBufferGeometry(shape: ShapeDefinition): THREE.BufferGeometry {
  switch (shape.primitive) {
    case "box":
      return new THREE.BoxGeometry(
        shape.params.width ?? 24,
        shape.params.height ?? 24,
        shape.params.depth ?? 24,
      );
    case "roundedBox":
      return new RoundedBoxGeometry(
        shape.params.width ?? 24,
        shape.params.height ?? 24,
        shape.params.depth ?? 24,
        2,
        Math.max(0.5, shape.params.bevelRadius ?? 2),
      );
    case "cylinder":
      return new THREE.CylinderGeometry(
        shape.params.radius ?? 12,
        shape.params.radius ?? 12,
        shape.params.height ?? 24,
        18,
      );
    case "sphere":
      return new THREE.SphereGeometry(shape.params.radius ?? 16, 18, 12);
    case "text": {
      const geometry = new TextGeometry(shape.params.text ?? "PRINT", {
        font,
        size: shape.params.textSize ?? 10,
        depth: shape.params.textDepth ?? 4,
        curveSegments: 6,
        bevelEnabled: false,
      });
      geometry.center();
      return geometry;
    }
    default:
      return new THREE.BoxGeometry(24, 24, 24);
  }
}

export function createMeshForShape(shape: ShapeDefinition) {
  const geometry = createBufferGeometry(shape);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: shape.color }),
  );

  mesh.name = shape.id;
  mesh.position.set(shape.position[0], shape.position[2], shape.position[1]);
  mesh.rotation.set(
    toRadians(shape.rotation[0]),
    toRadians(shape.rotation[2]),
    toRadians(shape.rotation[1]),
  );
  mesh.scale.set(shape.scale[0], shape.scale[2], shape.scale[1]);
  mesh.updateMatrixWorld(true);
  return mesh;
}

export function createImportedMesh(model: ImportedModel) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(model.vertices, 3),
  );

  if (model.normals.length > 0) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(model.normals, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: model.color }),
  );
  mesh.position.set(model.position[0], model.position[2], model.position[1]);
  mesh.rotation.set(
    toRadians(model.rotation[0]),
    toRadians(model.rotation[2]),
    toRadians(model.rotation[1]),
  );
  mesh.scale.set(model.scale[0], model.scale[2], model.scale[1]);
  mesh.updateMatrixWorld(true);
  return mesh;
}

export function buildFinalMesh(project: Pick<StudioProject, "shapes" | "importedModel">) {
  const additive: THREE.Mesh[] = [];
  const subtractive: THREE.Mesh[] = [];

  project.shapes.forEach((shape) => {
    const mesh = createMeshForShape(shape);
    if (shape.mode === "subtract") {
      subtractive.push(mesh);
    } else {
      additive.push(mesh);
    }
  });

  if (project.importedModel) {
    additive.push(createImportedMesh(project.importedModel));
  }

  if (additive.length === 0) {
    return null;
  }

  let working = additive[0];

  for (const mesh of additive.slice(1)) {
    working = CSG.union(working, mesh);
  }

  for (const mesh of subtractive) {
    working = CSG.subtract(working, mesh);
  }

  working.geometry.computeBoundingBox();
  working.geometry.computeVertexNormals();
  return working;
}

export function getBounds(project: StudioProject) {
  const mesh = buildFinalMesh(project);
  if (!mesh) {
    return null;
  }

  return new THREE.Box3().setFromObject(mesh);
}

export function analyzeProject(project: StudioProject): PrintAnalysis {
  const box = getBounds(project);
  const warnings: string[] = [];
  const notes: string[] = [];

  if (!box) {
    return {
      dimensionsMm: [0, 0, 0],
      fitsP1S: true,
      warnings: ["There is no printable geometry in the current scene."],
      notes,
    };
  }

  const size = new THREE.Vector3();
  box.getSize(size);
  const dimensions: Vec3 = [round(size.x), round(size.z), round(size.y)];
  const buildVolume = project.printerProfile.buildVolume;
  const fitsP1S =
    dimensions[0] <= buildVolume[0] &&
    dimensions[1] <= buildVolume[1] &&
    dimensions[2] <= buildVolume[2];

  if (!fitsP1S) {
    warnings.push(
      `Model exceeds the Bambu Lab P1S build volume of ${buildVolume.join(
        " x ",
      )} mm.`,
    );
  }

  if (box.min.z < -0.1) {
    warnings.push(
      "Part of the model sits below the build plate. Run Bambu prep before export.",
    );
  } else {
    notes.push("Model sits on or above the build plate.");
  }

  const thinnestFeature = estimateThinnestFeature(project.shapes);
  if (thinnestFeature < 1.2) {
    warnings.push(
      "Some parametric features are thinner than 1.2 mm and may print weakly on a 0.4 mm nozzle.",
    );
  } else {
    notes.push("Feature thickness is broadly compatible with a 0.4 mm nozzle.");
  }

  if (dimensions[2] > 120) {
    notes.push("Tall parts may benefit from a brim or slower outer wall speed.");
  }

  return {
    dimensionsMm: dimensions,
    fitsP1S,
    warnings,
    notes,
  };
}

export function estimateProjectAnalysis(project: StudioProject): PrintAnalysis {
  const box = new THREE.Box3();
  let hasGeometry = false;

  for (const shape of project.shapes) {
    if (shape.mode === "subtract") {
      continue;
    }

    const mesh = createMeshForShape(shape);
    box.union(new THREE.Box3().setFromObject(mesh));
    hasGeometry = true;
  }

  if (project.importedModel) {
    const mesh = createImportedMesh(project.importedModel);
    box.union(new THREE.Box3().setFromObject(mesh));
    hasGeometry = true;
  }

  if (!hasGeometry) {
    return {
      dimensionsMm: [0, 0, 0],
      fitsP1S: true,
      warnings: ["There is no printable geometry in the current scene."],
      notes: [],
    };
  }

  const size = new THREE.Vector3();
  box.getSize(size);
  const dimensions: Vec3 = [round(size.x), round(size.z), round(size.y)];
  const buildVolume = project.printerProfile.buildVolume;
  const fitsP1S =
    dimensions[0] <= buildVolume[0] &&
    dimensions[1] <= buildVolume[1] &&
    dimensions[2] <= buildVolume[2];

  return {
    dimensionsMm: dimensions,
    fitsP1S,
    warnings: fitsP1S ? [] : [`Approximate preview bounds exceed ${buildVolume.join(" x ")} mm.`],
    notes: ["Preview dimensions are estimated from additive geometry for a responsive UI."],
  };
}

function estimateThinnestFeature(shapes: ShapeDefinition[]) {
  const numericValues = shapes
    .flatMap((shape) => [
      shape.params.width,
      shape.params.depth,
      shape.params.height,
      shape.params.radius ? shape.params.radius * 2 : undefined,
      shape.params.textDepth,
    ])
    .filter((value): value is number => typeof value === "number");

  if (numericValues.length === 0) {
    return 999;
  }

  return Math.min(...numericValues);
}

export function prepareProjectForBambu(project: StudioProject) {
  const box = getBounds(project);
  if (!box) {
    return {
      project,
      analysis: analyzeProject(project),
    };
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  const shift: Vec3 = [-center.x, -center.z, -box.min.y];

  const nextProject: StudioProject = {
    ...project,
    shapes: project.shapes.map((shape) => ({
      ...shape,
      position: addVec3(shape.position, shift),
    })),
    importedModel: project.importedModel
      ? {
          ...project.importedModel,
          position: addVec3(project.importedModel.position, shift),
        }
      : null,
  };

  return {
    project: nextProject,
    analysis: analyzeProject(nextProject),
  };
}

export function exportProjectToStl(project: StudioProject) {
  const mesh = buildFinalMesh(project);
  if (!mesh) {
    throw new Error("Nothing to export.");
  }

  const exporter = new STLExporter();
  const stl = exporter.parse(mesh, { binary: false }) as string;
  const blob = new Blob([stl], { type: "model/stl" });
  return {
    blob,
    stl,
  };
}

export function serializeImportedGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  return {
    vertices: Array.from(position.array as ArrayLike<number>),
    normals: normal ? Array.from(normal.array as ArrayLike<number>) : [],
    triangleCount: position.count / 3,
  };
}

function addVec3(base: Vec3, shift: Vec3): Vec3 {
  return [
    round(base[0] + shift[0]),
    round(base[1] + shift[1]),
    round(base[2] + shift[2]),
  ];
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
