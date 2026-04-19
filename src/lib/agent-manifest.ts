import type { ToolManifestEntry } from "@/lib/studio-types";

export const AGENT_TOOL_MANIFEST: ToolManifestEntry[] = [
  {
    name: "set_project_brief",
    description: "Rename the project and store the user's modeling intent.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        brief: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        brief: { type: "string" },
      },
    },
  },
  {
    name: "list_scene",
    description:
      "Return the active shape list, imported STL metadata, and current Bambu P1S fit analysis.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        shapes: { type: "array" },
        importedModel: { type: ["object", "null"] },
        printAnalysis: { type: "object" },
      },
    },
  },
  {
    name: "create_ice_cube_tray",
    description:
      "Generate a polished subtractive tray model with rounded cavities and an embossed text badge.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {
        theme: { type: "string" },
        rows: { type: "number" },
        columns: { type: "number" },
        cavitySizeMm: { type: "number" },
        depthMm: { type: "number" },
        wallMm: { type: "number" },
        label: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        shapeCount: { type: "number" },
        projectName: { type: "string" },
      },
    },
  },
  {
    name: "upsert_shape",
    description:
      "Add a new parametric shape or update an existing one. Supported primitives: box, roundedBox, cylinder, sphere, text.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        primitive: { type: "string" },
        mode: { type: "string" },
        color: { type: "string" },
        position: { type: "array", items: { type: "number" } },
        rotation: { type: "array", items: { type: "number" } },
        scale: { type: "array", items: { type: "number" } },
        params: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        shapeCount: { type: "number" },
      },
    },
  },
  {
    name: "remove_shape",
    description: "Delete a shape by id.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        removed: { type: "boolean" },
        shapeCount: { type: "number" },
      },
    },
  },
  {
    name: "focus_shape",
    description: "Select a shape in the UI so the user can inspect it.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        selectedShapeId: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "prepare_for_bambu_p1s",
    description:
      "Center the model, place it on the build plate, and return recommended P1S print settings.",
    category: "scene",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        printer: { type: "string" },
        dimensionsMm: { type: "array" },
        fitsP1S: { type: "boolean" },
        notes: { type: "array" },
        warnings: { type: "array" },
      },
    },
  },
  {
    name: "run_print_checks",
    description:
      "Run a lightweight verification pass for size, orientation, and thin feature risks before export.",
    category: "verification",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        dimensionsMm: { type: "array" },
        fitsP1S: { type: "boolean" },
        warnings: { type: "array" },
        notes: { type: "array" },
      },
    },
  },
  {
    name: "capture_workspace_screenshot",
    description:
      "Capture the full workspace UI so the agent can verify sidebars, logs, and viewer state.",
    category: "verification",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        screenshotId: { type: "string" },
        dataUrl: { type: "string" },
      },
    },
  },
  {
    name: "capture_scene_screenshot",
    description:
      "Capture only the 3D viewer region. Useful for geometric verification after tool calls.",
    category: "verification",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        screenshotId: { type: "string" },
        dataUrl: { type: "string" },
      },
    },
  },
  {
    name: "export_stl",
    description:
      "Generate an STL file from the current scene and expose a browser download URL.",
    category: "export",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        sizeBytes: { type: "number" },
        downloadUrl: { type: "string" },
      },
    },
  },
];

export function buildConnectInstructions({
  sessionId,
  bridgeUrl,
  origin,
}: {
  sessionId: string;
  bridgeUrl: string;
  origin: string;
}) {
  const manifestUrl = `${origin}/api/agent-manifest`;
  const connectUrl = `${bridgeUrl}?role=studio&session=${sessionId}&name=PrintStudio`;

  return `Connect to PrintStudio session ${sessionId}

You are the agent for this PrintStudio session.

1. Start a local websocket server on your machine at:
${bridgeUrl}
2. Wait for the PrintStudio browser app to connect to:
${connectUrl}
3. Fetch the tool manifest from:
${manifestUrl}
4. When the browser connects, expect an initial studio message shaped like:
{"type":"studio.hello","payload":{"sessionId":"${sessionId}","tools":[...],"studio":"PrintStudio"}}
5. Reply with:
{"type":"agent.hello","payload":{"client":"Claude Code","name":"Claude Code","sessionId":"${sessionId}"}}
6. Invoke tools by sending JSON websocket messages shaped like:
{"type":"agent.tool_call","payload":{"callId":"call-1","tool":"create_ice_cube_tray","arguments":{"theme":"pokemon ice tray","rows":2,"columns":3,"label":"POKE ICE"}}}
7. Listen for tool results shaped like:
{"type":"studio.tool_result","payload":{"callId":"call-1","ok":true,"result":{...}}}
8. Use capture_scene_screenshot and capture_workspace_screenshot often to verify progress.

Recommended quick start:
curl -fsSL ${origin}/agent/connect.mjs -o host-printstudio.mjs
npm i ws
node host-printstudio.mjs --port 8787 --session "${sessionId}" --name "Claude Code"

That helper starts a local websocket server and a small CLI.
After it is running, PrintStudio should connect to it automatically or after you click the connect button again.`;
}
