export type Vec3 = [number, number, number];

export type PrimitiveKind =
  | "box"
  | "roundedBox"
  | "cylinder"
  | "sphere"
  | "text";

export type ShapeMode = "add" | "subtract";

export interface ShapeDefinition {
  id: string;
  label: string;
  primitive: PrimitiveKind;
  mode: ShapeMode;
  color: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  params: {
    width?: number;
    depth?: number;
    height?: number;
    radius?: number;
    bevelRadius?: number;
    text?: string;
    textSize?: number;
    textDepth?: number;
  };
}

export interface ImportedModel {
  id: string;
  name: string;
  color: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  vertices: number[];
  normals: number[];
  triangleCount: number;
}

export interface PrintProfile {
  printer: "bambu-lab-p1s";
  buildVolume: Vec3;
  nozzleMm: number;
  recommendedLayerHeightMm: number;
  materialNotes: string;
  supportAdvice: string;
}

export interface StudioProject {
  name: string;
  brief: string;
  printerProfile: PrintProfile;
  shapes: ShapeDefinition[];
  selectedShapeId: string | null;
  importedModel: ImportedModel | null;
}

export interface PrintAnalysis {
  dimensionsMm: Vec3;
  fitsP1S: boolean;
  warnings: string[];
  notes: string[];
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  category: "scene" | "verification" | "export";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ActivityEntry {
  id: string;
  kind: "system" | "tool" | "agent" | "verification";
  message: string;
  detail?: string;
  status?: "info" | "success" | "warning" | "error";
  timestamp: string;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  summary: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  resultPreview?: string;
}

export interface ScreenshotRecord {
  id: string;
  label: string;
  source: "workspace" | "scene";
  dataUrl: string;
  createdAt: string;
}
