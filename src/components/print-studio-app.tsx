"use client";

import Image from "next/image";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { nanoid } from "nanoid/non-secure";
import { StudioCanvas } from "@/components/studio-canvas";
import { AGENT_TOOL_MANIFEST, buildConnectInstructions } from "@/lib/agent-manifest";
import {
  analyzeProject,
  createBlankProject,
  createIceCubeTrayProject,
  createShape,
  createStarterProject,
  estimateProjectAnalysis,
  exportProjectToStl,
  prepareProjectForBambu,
  serializeImportedGeometry,
} from "@/lib/studio-model";
import type {
  ActivityEntry,
  ImportedModel,
  ScreenshotRecord,
  ShapeDefinition,
  StudioProject,
  ToolCallRecord,
  Vec3,
} from "@/lib/studio-types";

type ToolCallPayload = {
  callId: string;
  tool: string;
  arguments?: Record<string, unknown>;
};

type ExportArtifact = {
  filename: string;
  downloadUrl: string;
  sizeBytes: number;
} | null;

function getDefaultBridgeUrl() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_PRINTSTUDIO_BRIDGE_URL ?? "";
  }

  const stored = window.localStorage.getItem("printstudio.bridgeUrl");
  if (stored) {
    return stored;
  }

  if (process.env.NEXT_PUBLIC_PRINTSTUDIO_BRIDGE_URL) {
    return process.env.NEXT_PUBLIC_PRINTSTUDIO_BRIDGE_URL;
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "ws://localhost:8787";
  }

  return "";
}

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildShapeSummary(shape: ShapeDefinition) {
  return `${shape.label} · ${shape.primitive} · ${shape.mode}`;
}

function createActivity(
  kind: ActivityEntry["kind"],
  message: string,
  detail?: string,
  status: ActivityEntry["status"] = "info",
): ActivityEntry {
  return {
    id: nanoid(10),
    kind,
    message,
    detail,
    status,
    timestamp: timestamp(),
  };
}

function ensureVec3(input: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(input) || input.length < 3) {
    return fallback;
  }

  return [
    Number(input[0] ?? fallback[0]),
    Number(input[1] ?? fallback[1]),
    Number(input[2] ?? fallback[2]),
  ];
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function numberInput(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step = 1,
) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
      />
    </label>
  );
}

export function PrintStudioApp() {
  const [project, setProject] = useState<StudioProject>(() => createStarterProject());
  const [activity, setActivity] = useState<ActivityEntry[]>([
    createActivity(
      "system",
      "PrintStudio booted",
      "The workspace is ready for live modeling, verification, and STL export.",
      "success",
    ),
  ]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotRecord[]>([]);
  const [bridgeUrl, setBridgeUrl] = useState(() => getDefaultBridgeUrl());
  const [bridgeState, setBridgeState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentName, setAgentName] = useState("No agent");
  const [sessionId] = useState(() => nanoid(8).toUpperCase());
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>("tray-shell");
  const [viewerMode, setViewerMode] = useState<"final" | "assembly">("final");
  const [connectPanelOpen, setConnectPanelOpen] = useState(false);
  const [exportArtifact, setExportArtifact] = useState<ExportArtifact>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const projectRef = useRef(project);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (bridgeUrl) {
      window.localStorage.setItem("printstudio.bridgeUrl", bridgeUrl);
    }
  }, [bridgeUrl]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const printAnalysis = useMemo(() => estimateProjectAnalysis(project), [project]);
  const selectedShape = project.shapes.find((shape) => shape.id === selectedShapeId) ?? null;
  const bridgeUrlValid = bridgeUrl ? isValidUrl(bridgeUrl) : true;
  const connectInstructions = useMemo(
    () =>
      buildConnectInstructions({
        sessionId,
        bridgeUrl,
        origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
    [bridgeUrl, sessionId],
  );
  const displayedBridgeState = !bridgeUrl
    ? "idle"
    : !bridgeUrlValid
      ? "error"
      : bridgeState === "idle"
        ? "connecting"
        : bridgeState;

  const logActivity = useCallback(
    (
      kind: ActivityEntry["kind"],
      message: string,
      detail?: string,
      status: ActivityEntry["status"] = "info",
    ) => {
      setActivity((current) =>
        [createActivity(kind, message, detail, status), ...current].slice(0, 32),
      );
    },
    [],
  );

  const sendSocketMessage = useCallback((type: string, payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type, payload }));
  }, []);

  const captureNode = useCallback(
    async (
      node: HTMLElement | null,
      label: string,
      source: ScreenshotRecord["source"],
    ) => {
      if (!node) {
        throw new Error("Nothing to capture.");
      }

      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const dataUrl = await toPng(node, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#f8f5ee",
      });
      const record: ScreenshotRecord = {
        id: nanoid(10),
        label,
        source,
        dataUrl,
        createdAt: timestamp(),
      };
      setScreenshots((current) => [record, ...current].slice(0, 8));
      return record;
    },
    [],
  );

  const applyProject = useCallback((nextProject: StudioProject) => {
    projectRef.current = nextProject;
    setProject(nextProject);
    setSelectedShapeId(nextProject.selectedShapeId);
  }, []);

  const startToolCall = useCallback((tool: string, summary: string) => {
    const id = nanoid(10);
    setToolCalls((current) => [
      {
        id,
        tool,
        summary,
        status: "running" as const,
        startedAt: timestamp(),
      },
      ...current,
    ].slice(0, 16));
    return id;
  }, []);

  const finishToolCall = useCallback(
    (id: string, status: ToolCallRecord["status"], resultPreview?: string) => {
      setToolCalls((current) =>
        current.map((call) =>
          call.id === id
            ? {
                ...call,
                status,
                resultPreview,
                finishedAt: timestamp(),
              }
            : call,
        ),
      );
    },
    [],
  );

  const executeTool = useCallback(async (payload: ToolCallPayload) => {
    const args = payload.arguments ?? {};
    const toolCallId = startToolCall(payload.tool, JSON.stringify(args));

    try {
      let result: unknown;

      switch (payload.tool) {
        case "set_project_brief": {
          const nextProject = {
            ...projectRef.current,
            name: String(args.name ?? projectRef.current.name),
            brief: String(args.brief ?? projectRef.current.brief),
          };
          applyProject(nextProject);
          logActivity("agent", "Project brief updated", nextProject.brief, "success");
          result = { name: nextProject.name, brief: nextProject.brief };
          break;
        }
        case "list_scene": {
          result = {
            shapes: projectRef.current.shapes.map((shape) => ({
              id: shape.id,
              label: shape.label,
              primitive: shape.primitive,
              mode: shape.mode,
              position: shape.position,
              rotation: shape.rotation,
              params: shape.params,
            })),
            importedModel: projectRef.current.importedModel
              ? {
                  name: projectRef.current.importedModel.name,
                  triangleCount: projectRef.current.importedModel.triangleCount,
                }
              : null,
            printAnalysis: analyzeProject(projectRef.current),
          };
          break;
        }
        case "create_ice_cube_tray": {
          const nextProject = createIceCubeTrayProject({
            theme: String(args.theme ?? "Agent Tray"),
            rows: Number(args.rows ?? 2),
            columns: Number(args.columns ?? 3),
            cavitySizeMm: Number(args.cavitySizeMm ?? 34),
            depthMm: Number(args.depthMm ?? 16),
            wallMm: Number(args.wallMm ?? 4),
            label: String(args.label ?? "ICE"),
          });
          applyProject(nextProject);
          logActivity("tool", "Tray recipe generated", nextProject.name, "success");
          result = { shapeCount: nextProject.shapes.length, projectName: nextProject.name };
          break;
        }
        case "upsert_shape": {
          const primitive = String(args.primitive ?? "box") as ShapeDefinition["primitive"];
          const incomingId = typeof args.id === "string" ? args.id : nanoid(8);
          const existing = projectRef.current.shapes.find((shape) => shape.id === incomingId);
          const nextShape = createShape(primitive, {
            ...existing,
            id: incomingId,
            label: String(args.label ?? existing?.label ?? "Agent Shape"),
            primitive,
            mode: String(args.mode ?? existing?.mode ?? "add") as ShapeDefinition["mode"],
            color: String(args.color ?? existing?.color ?? "#0f766e"),
            position: ensureVec3(args.position, existing?.position ?? [0, 0, 12]),
            rotation: ensureVec3(args.rotation, existing?.rotation ?? [0, 0, 0]),
            scale: ensureVec3(args.scale, existing?.scale ?? [1, 1, 1]),
            params: {
              ...existing?.params,
              ...(typeof args.params === "object" && args.params ? args.params : {}),
            },
          });
          const shapes = existing
            ? projectRef.current.shapes.map((shape) =>
                shape.id === incomingId ? nextShape : shape,
              )
            : [...projectRef.current.shapes, nextShape];
          const nextProject = {
            ...projectRef.current,
            shapes,
            selectedShapeId: nextShape.id,
          };
          applyProject(nextProject);
          logActivity("tool", "Shape updated", buildShapeSummary(nextShape), "success");
          result = { id: nextShape.id, shapeCount: shapes.length };
          break;
        }
        case "remove_shape": {
          const id = String(args.id ?? "");
          const shapes = projectRef.current.shapes.filter((shape) => shape.id !== id);
          const removed = shapes.length !== projectRef.current.shapes.length;
          const nextProject = {
            ...projectRef.current,
            shapes,
            selectedShapeId: removed ? null : projectRef.current.selectedShapeId,
          };
          applyProject(nextProject);
          logActivity(
            "tool",
            removed ? "Shape removed" : "Shape not found",
            id,
            removed ? "success" : "warning",
          );
          result = { removed, shapeCount: shapes.length };
          break;
        }
        case "focus_shape": {
          const id = typeof args.id === "string" ? args.id : null;
          setSelectedShapeId(id);
          result = { selectedShapeId: id };
          break;
        }
        case "prepare_for_bambu_p1s": {
          const prepared = prepareProjectForBambu(projectRef.current);
          applyProject(prepared.project);
          logActivity(
            "verification",
            "Bambu P1S prep applied",
            `${prepared.analysis.dimensionsMm.join(" x ")} mm`,
            prepared.analysis.fitsP1S ? "success" : "warning",
          );
          result = {
            printer: "Bambu Lab P1S",
            dimensionsMm: prepared.analysis.dimensionsMm,
            fitsP1S: prepared.analysis.fitsP1S,
            warnings: prepared.analysis.warnings,
            notes: prepared.analysis.notes,
          };
          break;
        }
        case "run_print_checks": {
          const analysis = analyzeProject(projectRef.current);
          logActivity(
            "verification",
            "Print checks completed",
            `${analysis.dimensionsMm.join(" x ")} mm`,
            analysis.fitsP1S ? "success" : "warning",
          );
          result = analysis;
          break;
        }
        case "capture_workspace_screenshot": {
          const shot = await captureNode(workspaceRef.current, "Workspace capture", "workspace");
          logActivity("verification", "Workspace screenshot captured", shot.id, "success");
          result = { screenshotId: shot.id, dataUrl: shot.dataUrl };
          break;
        }
        case "capture_scene_screenshot": {
          const shot = await captureNode(viewerRef.current, "Scene capture", "scene");
          logActivity("verification", "Scene screenshot captured", shot.id, "success");
          result = { screenshotId: shot.id, dataUrl: shot.dataUrl };
          break;
        }
        case "export_stl": {
          const filenameBase = String(args.filename ?? projectRef.current.name ?? "printstudio-model")
            .trim()
            .replace(/[^a-z0-9-_]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();
          const filename = `${filenameBase || "printstudio-model"}.stl`;
          const { blob } = exportProjectToStl(projectRef.current);
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
          }
          const downloadUrl = URL.createObjectURL(blob);
          objectUrlRef.current = downloadUrl;
          setExportArtifact({
            filename,
            downloadUrl,
            sizeBytes: blob.size,
          });
          logActivity("tool", "STL exported", `${filename} · ${formatBytes(blob.size)}`, "success");
          result = {
            filename,
            sizeBytes: blob.size,
            downloadUrl,
          };
          break;
        }
        default:
          throw new Error(`Unknown tool: ${payload.tool}`);
      }

      finishToolCall(toolCallId, "success", JSON.stringify(result).slice(0, 180));
      sendSocketMessage("studio.tool_result", {
        callId: payload.callId,
        ok: true,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      finishToolCall(toolCallId, "error", message);
      logActivity("tool", "Tool call failed", message, "error");
      sendSocketMessage("studio.tool_result", {
        callId: payload.callId,
        ok: false,
        error: message,
      });
    }
  }, [
    applyProject,
    captureNode,
    finishToolCall,
    logActivity,
    sendSocketMessage,
    startToolCall,
  ]);

  useEffect(() => {
    if (!bridgeUrl || !bridgeUrlValid) {
      return undefined;
    }

    const url = new URL(bridgeUrl);
    url.searchParams.set("role", "studio");
    url.searchParams.set("session", sessionId);
    url.searchParams.set("name", "PrintStudio");

    const socket = new WebSocket(url.toString());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setBridgeState("connected");
      logActivity("system", "Bridge connected", url.toString(), "success");
      sendSocketMessage("studio.hello", {
        sessionId,
        tools: AGENT_TOOL_MANIFEST,
        studio: "PrintStudio",
      });
    });

    socket.addEventListener("message", async (event) => {
      const data = JSON.parse(String(event.data)) as {
        type: string;
        payload?: Record<string, unknown>;
      };

      switch (data.type) {
        case "bridge.ready":
          return;
        case "agent.hello":
          setAgentConnected(true);
          setAgentName(String(data.payload?.name ?? "Connected agent"));
          logActivity(
            "agent",
            "Agent joined the session",
            String(data.payload?.name ?? "Unknown"),
            "success",
          );
          sendSocketMessage("studio.hello", {
            sessionId,
            tools: AGENT_TOOL_MANIFEST,
            studio: "PrintStudio",
          });
          return;
        case "peer.presence":
          if (data.payload?.role === "agent") {
            const connected = data.payload?.state === "connected";
            setAgentConnected(connected);
            setAgentName(connected ? String(data.payload?.name ?? "Connected agent") : "No agent");
            logActivity(
              "system",
              connected ? "Agent socket connected" : "Agent socket disconnected",
              String(data.payload?.name ?? "Unnamed"),
              connected ? "success" : "warning",
            );
          }
          return;
        case "agent.tool_call":
          await executeTool({
            callId: String(data.payload?.callId ?? nanoid(8)),
            tool: String(data.payload?.tool ?? ""),
            arguments:
              typeof data.payload?.arguments === "object" && data.payload.arguments
                ? (data.payload.arguments as Record<string, unknown>)
                : {},
          });
          return;
        default:
          logActivity("agent", "Unhandled socket message", data.type, "warning");
      }
    });

    socket.addEventListener("close", () => {
      setBridgeState("idle");
      setAgentConnected(false);
      setAgentName("No agent");
      logActivity("system", "Bridge disconnected", bridgeUrl, "warning");
    });

    socket.addEventListener("error", () => {
      setBridgeState("error");
      logActivity("system", "Bridge connection error", bridgeUrl, "error");
    });

    return () => {
      socket.close();
    };
  }, [bridgeUrl, bridgeUrlValid, executeTool, logActivity, sendSocketMessage, sessionId]);

  const copyInstructions = useCallback(async () => {
    setConnectPanelOpen(true);

    try {
      await navigator.clipboard.writeText(connectInstructions);
      logActivity("system", "Connect instructions copied", `Session ${sessionId}`, "success");
    } catch {
      logActivity(
        "system",
        "Connect instructions opened",
        "Clipboard access was unavailable, so the instructions remain visible in the panel.",
        "warning",
      );
    }
  }, [connectInstructions, logActivity, sessionId]);

  const handleQuickExport = useCallback(async () => {
    await executeTool({
      callId: nanoid(8),
      tool: "export_stl",
      arguments: { filename: project.name },
    });
  }, [executeTool, project.name]);

  const createNewBlankProject = useCallback(() => {
    applyProject(createBlankProject());
    setViewerMode("final");
    logActivity("system", "Blank project created", "The tray and imported geometry were cleared.", "success");
  }, [applyProject, logActivity]);

  const resetToTray = useCallback(() => {
    applyProject(
      createIceCubeTrayProject({
        theme: "Quick Tray",
        label: "ICE",
      }),
    );
    setViewerMode("final");
    logActivity("system", "Tray preset loaded", "A fresh single-tray starting point is ready.", "success");
  }, [applyProject, logActivity]);

  const addPrimitive = useCallback((primitive: ShapeDefinition["primitive"]) => {
    const nextShape = createShape(primitive, {
      position: [0, 0, primitive === "text" ? 24 : 16],
    });
    const nextProject = {
      ...projectRef.current,
      shapes: [...projectRef.current.shapes, nextShape],
      selectedShapeId: nextShape.id,
    };
    applyProject(nextProject);
    logActivity("tool", "Primitive added", buildShapeSummary(nextShape), "success");
  }, [applyProject, logActivity]);

  const updateSelectedShape = useCallback((patch: Partial<ShapeDefinition>) => {
    if (!selectedShapeId) {
      return;
    }

    setProject((current) => {
      const shapes = current.shapes.map((shape) =>
        shape.id === selectedShapeId
          ? {
              ...shape,
              ...patch,
              params: {
                ...shape.params,
                ...patch.params,
              },
            }
          : shape,
      );
      const nextProject = {
        ...current,
        shapes,
        selectedShapeId,
      };
      projectRef.current = nextProject;
      return nextProject;
    });
    setSelectedShapeId(selectedShapeId);
  }, [selectedShapeId]);

  const importStl = useCallback(async (file: File) => {
    const loader = new STLLoader();
    const buffer = await file.arrayBuffer();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();
    const serialized = serializeImportedGeometry(geometry);
    const importedModel: ImportedModel = {
      id: nanoid(8),
      name: file.name,
      color: "#64748b",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      vertices: serialized.vertices,
      normals: serialized.normals,
      triangleCount: serialized.triangleCount,
    };
    const nextProject = {
      ...projectRef.current,
      importedModel,
    };
    applyProject(nextProject);
    logActivity(
      "tool",
      "STL imported",
      `${file.name} · ${importedModel.triangleCount.toLocaleString()} triangles`,
      "success",
    );
  }, [applyProject, logActivity]);

  return (
    <main className="grain min-h-screen px-3 py-3 text-slate-900 md:px-4">
      <div
        ref={workspaceRef}
        className={`mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1720px] grid-cols-1 gap-3 rounded-[24px] border border-white/70 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.10)] lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_280px] ${agentConnected ? "agent-glow" : ""}`}
        style={{ backgroundImage: "var(--hero)" }}
      >
        <section className="panel panel-strong rounded-[20px] p-4 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">
                PrintStudio
              </p>
              <h1 className="mt-2 text-[30px] font-semibold leading-none text-slate-900">
                Agent STL workspace
              </h1>
            </div>
            <div className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 font-mono text-[10px] text-slate-600">
              {sessionId}
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-700">
            Model in-browser, connect an agent over websocket, verify with screenshots,
            then export for the Bambu Lab P1S.
          </p>

          <div
            className={`mt-4 rounded-[18px] border px-3 py-3 ${agentConnected ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white/70"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Agent State
                </p>
                <p className="mt-1 text-base font-semibold text-slate-900">{agentName}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] ${agentConnected ? "bg-emerald-600 text-white" : "bg-slate-900 text-white"}`}
              >
                {agentConnected ? "Connected" : "Waiting"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {agentConnected
                ? "The workspace is now emitting live tool activity and screenshots for the connected agent."
                : "Click connect, paste the instructions into your agent, and start issuing modeling tool calls."}
            </p>
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Bridge URL
            </span>
            <input
              value={bridgeUrl}
              onChange={(event) => setBridgeUrl(event.target.value)}
              className="w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none ring-0"
              placeholder="ws://localhost:8787"
            />
          </label>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void copyInstructions()}
              className="rounded-[16px] bg-slate-950 px-3 py-2.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              Connect Agent
            </button>
            <button
              type="button"
              onClick={createNewBlankProject}
              className="rounded-[16px] border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-900 transition hover:bg-slate-50"
            >
              New Blank Project
            </button>
          </div>

          {connectPanelOpen ? (
            <div className="mt-3 rounded-[18px] border border-slate-200 bg-white/90 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Agent Instructions
                </p>
                <button
                  type="button"
                  onClick={() => setConnectPanelOpen(false)}
                  className="text-[11px] font-medium text-slate-500"
                >
                  Close
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                These were copied to your clipboard when possible. If not, copy them from here.
              </p>
              <textarea
                readOnly
                value={connectInstructions}
                className="mt-3 min-h-44 w-full rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-[11px] leading-5 text-slate-700 outline-none"
              />
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={resetToTray}
              className="rounded-[16px] border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-900 transition hover:bg-slate-50"
            >
              Load Tray Preset
            </button>
            <button
              type="button"
              onClick={() =>
                void executeTool({
                  callId: nanoid(8),
                  tool: "prepare_for_bambu_p1s",
                })
              }
              className="rounded-[16px] border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-900"
            >
              Prepare For P1S
            </button>
            <button
              type="button"
              onClick={() => void handleQuickExport()}
              className="rounded-[16px] border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs font-medium text-sky-900"
            >
              Export STL
            </button>
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Project Brief
            </span>
            <textarea
              value={project.brief}
              onChange={(event) =>
                applyProject({
                  ...project,
                  brief: event.target.value,
                })
              }
              className="min-h-20 w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 outline-none"
            />
          </label>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Quick Shapes
              </p>
              <p className="text-[11px] text-slate-500">{project.shapes.length} shapes</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["box", "roundedBox", "cylinder", "sphere", "text"] as const).map((primitive) => (
                <button
                  key={primitive}
                  type="button"
                  onClick={() => addPrimitive(primitive)}
                  className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium capitalize text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Add {primitive}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Import STL
            </label>
            <input
              type="file"
              accept=".stl"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importStl(file);
                }
              }}
              className="w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-xs"
            />
            {project.importedModel ? (
              <div className="mt-2 rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700">
                {project.importedModel.name} ·{" "}
                {project.importedModel.triangleCount.toLocaleString()} triangles
              </div>
            ) : null}
          </div>

          {selectedShape ? (
            <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Selected Shape
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void executeTool({
                      callId: nanoid(8),
                      tool: "remove_shape",
                      arguments: { id: selectedShape.id },
                    })
                  }
                  className="text-[11px] font-medium text-rose-700"
                >
                  Remove
                </button>
              </div>
              <input
                value={selectedShape.label}
                onChange={(event) => updateSelectedShape({ label: event.target.value })}
                className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={selectedShape.mode}
                  onChange={(event) =>
                    updateSelectedShape({
                      mode: event.target.value as ShapeDefinition["mode"],
                    })
                  }
                  className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                >
                  <option value="add">Additive</option>
                  <option value="subtract">Subtractive</option>
                </select>
                <input
                  type="color"
                  value={selectedShape.color}
                  onChange={(event) => updateSelectedShape({ color: event.target.value })}
                  className="h-10 w-full rounded-[14px] border border-slate-200 bg-slate-50 p-1"
                />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={`position-${index}`}>
                    {numberInput(["Pos X", "Pos Y", "Pos Z"][index], selectedShape.position[index], (value) => {
                      const next = [...selectedShape.position] as Vec3;
                      next[index] = value;
                      updateSelectedShape({ position: next });
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={`rotation-${index}`}>
                    {numberInput(["Rot X", "Rot Y", "Rot Z"][index], selectedShape.rotation[index], (value) => {
                      const next = [...selectedShape.rotation] as Vec3;
                      next[index] = value;
                      updateSelectedShape({ rotation: next });
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={`scale-${index}`}>
                    {numberInput(["Scale X", "Scale Y", "Scale Z"][index], selectedShape.scale[index], (value) => {
                      const next = [...selectedShape.scale] as Vec3;
                      next[index] = value;
                      updateSelectedShape({ scale: next });
                    }, 0.1)}
                  </div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                {selectedShape.primitive === "text" ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Text
                      </span>
                      <input
                        value={selectedShape.params.text ?? ""}
                        onChange={(event) =>
                          updateSelectedShape({
                            params: { text: event.target.value },
                          })
                        }
                        className="w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                      />
                    </label>
                    <div>
                      {numberInput("Text Size", selectedShape.params.textSize ?? 10, (value) =>
                        updateSelectedShape({
                          params: { textSize: value },
                        }),
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      {numberInput(
                        selectedShape.primitive === "sphere" || selectedShape.primitive === "cylinder"
                          ? "Radius"
                          : "Width",
                        selectedShape.params.width ?? selectedShape.params.radius ?? 10,
                        (value) =>
                          updateSelectedShape({
                            params:
                              selectedShape.primitive === "sphere" || selectedShape.primitive === "cylinder"
                                ? { radius: value }
                                : { width: value },
                          }),
                      )}
                    </div>
                    <div>
                      {numberInput(
                        "Height",
                        selectedShape.params.height ?? selectedShape.params.textDepth ?? 10,
                        (value) =>
                          updateSelectedShape({
                            params: { height: value },
                          }),
                      )}
                    </div>
                  </>
                )}
              </div>

              {selectedShape.primitive === "box" || selectedShape.primitive === "roundedBox" ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    {numberInput("Depth", selectedShape.params.depth ?? 10, (value) =>
                      updateSelectedShape({
                        params: { depth: value },
                      }),
                    )}
                  </div>
                  {selectedShape.primitive === "roundedBox" ? (
                    <div>
                      {numberInput(
                        "Bevel",
                        selectedShape.params.bevelRadius ?? 2,
                        (value) =>
                          updateSelectedShape({
                            params: { bevelRadius: value },
                          }),
                        0.5,
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel panel-strong rounded-[20px] p-3">
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between rounded-[18px] border border-white/70 bg-white/65 px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Active Project
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{project.name}</h2>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Bridge
                </p>
                <p className="mt-1 text-xs font-medium text-slate-900">{displayedBridgeState}</p>
              </div>
            </div>

            <div
              ref={viewerRef}
              className="relative min-h-[560px] flex-1 overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100 lg:min-h-[620px]"
            >
              <div className="absolute left-3 top-3 z-10 rounded-full bg-slate-950/82 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
                {agentConnected ? "Agent view live" : "Viewer"} · {viewerMode}
              </div>
              <div className="absolute right-3 top-3 z-10 flex rounded-full border border-slate-200 bg-white/90 p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => startTransition(() => setViewerMode("final"))}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${
                    viewerMode === "final"
                      ? "bg-slate-950 text-white"
                      : "text-slate-700"
                  }`}
                >
                  Final Solid
                </button>
                <button
                  type="button"
                  onClick={() => startTransition(() => setViewerMode("assembly"))}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${
                    viewerMode === "assembly"
                      ? "bg-slate-950 text-white"
                      : "text-slate-700"
                  }`}
                >
                  Assembly
                </button>
              </div>
              <div className="absolute bottom-3 left-3 z-10 rounded-[16px] bg-white/88 px-3 py-2 text-xs text-slate-700 shadow-lg">
                {printAnalysis.dimensionsMm.join(" x ")} mm
              </div>
              <StudioCanvas
                project={{
                  shapes: project.shapes,
                  importedModel: project.importedModel,
                }}
                selectedShapeId={selectedShapeId}
                agentConnected={agentConnected}
                viewMode={viewerMode}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Bambu P1S
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {project.printerProfile.buildVolume.join(" x ")} mm
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  0.4 mm nozzle · {project.printerProfile.recommendedLayerHeightMm} mm layers
                </p>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Print Fit
                </p>
                <p className={`mt-2 text-xl font-semibold ${printAnalysis.fitsP1S ? "text-emerald-700" : "text-amber-700"}`}>
                  {printAnalysis.fitsP1S ? "Ready" : "Needs work"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {printAnalysis.warnings[0] ?? "Current model fits the P1S envelope."}
                </p>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Latest STL
                </p>
                {exportArtifact ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{exportArtifact.filename}</p>
                    <a
                      href={exportArtifact.downloadUrl}
                      download={exportArtifact.filename}
                      className="mt-2 inline-flex rounded-full bg-slate-950 px-3 py-2 text-xs font-medium text-white"
                    >
                      Download {formatBytes(exportArtifact.sizeBytes)}
                    </a>
                  </>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    Export an STL to make a browser download link available.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Verification Captures
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void executeTool({
                        callId: nanoid(8),
                        tool: "capture_scene_screenshot",
                      })
                    }
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-900"
                  >
                    Capture Scene
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void executeTool({
                        callId: nanoid(8),
                        tool: "capture_workspace_screenshot",
                      })
                    }
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-900"
                  >
                    Capture Workspace
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {screenshots.length > 0 ? (
                  screenshots.map((shot) => (
                    <figure
                      key={shot.id}
                      className="overflow-hidden rounded-[16px] border border-slate-200 bg-slate-50"
                    >
                      <Image
                        src={shot.dataUrl}
                        alt={shot.label}
                        width={640}
                        height={360}
                        unoptimized
                        className="h-28 w-full object-cover"
                      />
                      <figcaption className="px-3 py-2 text-[11px] text-slate-600">
                        {shot.label} · {shot.createdAt}
                      </figcaption>
                    </figure>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-slate-600">
                    No screenshots yet. Agents should use these tools aggressively while iterating.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="panel panel-strong rounded-[20px] p-4 lg:col-span-2 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto xl:col-span-1">
          <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Agent Tools
            </p>
            <div className="mt-3 space-y-2">
              {AGENT_TOOL_MANIFEST.map((tool) => (
                <div key={tool.name} className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{tool.name}</p>
                    <span className="rounded-full bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                      {tool.category}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Live Tool Calls
              </p>
              <p className="text-[11px] text-slate-500">{toolCalls.length} tracked</p>
            </div>
            <div className="mt-3 space-y-2">
              {toolCalls.length > 0 ? (
                toolCalls.map((call) => (
                  <div key={call.id} className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900">{call.tool}</p>
                      <span
                        className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${
                          call.status === "success"
                            ? "bg-emerald-100 text-emerald-800"
                            : call.status === "error"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-900 text-white"
                        }`}
                      >
                        {call.status}
                      </span>
                    </div>
                    <p className="mt-1.5 break-all font-mono text-[11px] text-slate-500">{call.summary}</p>
                    {call.resultPreview ? (
                      <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{call.resultPreview}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-slate-600">
                  When an agent connects, every tool call and result will stream here.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Session Activity
              </p>
              <p className="text-[11px] text-slate-500">{activity.length} events</p>
            </div>
            <div className="mt-3 space-y-2">
              {activity.map((entry) => (
                <div key={entry.id} className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{entry.message}</p>
                    <span className="font-mono text-[10px] text-slate-500">{entry.timestamp}</span>
                  </div>
                  {entry.detail ? <p className="mt-1.5 text-xs leading-5 text-slate-600">{entry.detail}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
