import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { WebSocketServer } from "ws";

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.reduce((pairs, item, index) => {
    if (!item.startsWith("--")) {
      return pairs;
    }

    pairs.push([item.slice(2), args[index + 1]]);
    return pairs;
  }, []),
);

const port = Number(flags.port ?? 8787);
const host = flags.host ?? "127.0.0.1";
const preferredSession = flags.session ?? "default";
const agentName = flags.name ?? "Claude Code";
const artifactsDir = path.resolve(process.cwd(), flags.artifacts ?? "printstudio-artifacts");

let studioSocket = null;
let activeSession = preferredSession;
let currentStudioName = "PrintStudio";
let lastManifest = [];

fs.mkdirSync(artifactsDir, { recursive: true });

function sendToStudio(type, payload) {
  if (!studioSocket || studioSocket.readyState !== studioSocket.OPEN) {
    console.log("No PrintStudio browser is connected yet.");
    return false;
  }

  studioSocket.send(JSON.stringify({ type, payload }));
  return true;
}

function summarizeResult(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const clone = { ...payload };
  const result = clone.result;

  if (result && typeof result === "object" && typeof result.dataUrl === "string") {
    const match = result.dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (match) {
      const screenshotId = String(result.screenshotId ?? `shot-${Date.now()}`);
      const filePath = path.join(artifactsDir, `${screenshotId}.png`);
      fs.writeFileSync(filePath, match[1], "base64");
      clone.result = {
        ...result,
        dataUrl: `[saved to ${filePath}]`,
      };
    }
  }

  return clone;
}

function printHelp() {
  console.log("");
  console.log("Commands:");
  console.log('  call <tool_name> {"arg":"value"}');
  console.log("  hello");
  console.log("  tools");
  console.log("  status");
  console.log("  quit");
  console.log("");
}

const wss = new WebSocketServer({ host, port });

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `ws://${request.headers.host}`);
  const role = url.searchParams.get("role") ?? "studio";
  const sessionId = url.searchParams.get("session") ?? preferredSession;
  const studioName = url.searchParams.get("name") ?? "PrintStudio";

  if (role !== "studio") {
    socket.close(1008, "This local server only accepts PrintStudio browser clients.");
    return;
  }

  if (studioSocket && studioSocket.readyState === studioSocket.OPEN) {
    studioSocket.close(1012, "A newer PrintStudio session replaced this connection.");
  }

  studioSocket = socket;
  activeSession = sessionId;
  currentStudioName = studioName;

  console.log(`PrintStudio connected: ${studioName} (${sessionId})`);

  socket.send(
    JSON.stringify({
      type: "server.ready",
      payload: { sessionId, role: "agent-server", name: agentName },
    }),
  );

  socket.send(
    JSON.stringify({
      type: "agent.hello",
      payload: { sessionId, name: agentName, client: "Local Agent Server" },
    }),
  );

  socket.on("message", (data) => {
    try {
      const message = JSON.parse(String(data));

      if (message.type === "studio.hello") {
        const tools = Array.isArray(message.payload?.tools) ? message.payload.tools : [];
        lastManifest = tools;
        console.log(`Studio ready. ${tools.length} tools available.`);
        return;
      }

      if (message.type === "studio.tool_result") {
        console.log(JSON.stringify(summarizeResult(message.payload), null, 2));
        return;
      }

      console.log(JSON.stringify(message, null, 2));
    } catch (error) {
      console.log(`Invalid JSON from studio: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  });

  socket.on("close", () => {
    if (studioSocket === socket) {
      studioSocket = null;
    }
    console.log("PrintStudio disconnected.");
  });
});

wss.on("listening", () => {
  console.log(`Local PrintStudio agent server listening on ws://${host}:${port}`);
  console.log(`Session: ${preferredSession}`);
  console.log(`Agent name: ${agentName}`);
  console.log(`Artifacts: ${artifactsDir}`);
  printHelp();
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed === "quit" || trimmed === "exit") {
    rl.close();
    wss.close();
    process.exit(0);
  }

  if (trimmed === "help") {
    printHelp();
    return;
  }

  if (trimmed === "status") {
    console.log(
      JSON.stringify(
        {
          connected: Boolean(studioSocket && studioSocket.readyState === studioSocket.OPEN),
          sessionId: activeSession,
          studio: currentStudioName,
          agent: agentName,
          artifactsDir,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (trimmed === "tools") {
    if (lastManifest.length === 0) {
      console.log("No manifest received yet.");
      return;
    }

    console.log(
      lastManifest
        .map((tool) => `${tool.name} [${tool.category}]`)
        .join("\n"),
    );
    return;
  }

  if (trimmed === "hello") {
    sendToStudio("agent.hello", {
      sessionId: activeSession,
      name: agentName,
      client: "Local Agent Server",
    });
    return;
  }

  if (!trimmed.startsWith("call ")) {
    console.log("Unknown command. Type 'help' for available commands.");
    return;
  }

  const [, tool, ...rest] = trimmed.split(" ");
  const joined = rest.join(" ").trim();

  try {
    const parsed = joined ? JSON.parse(joined) : {};
    sendToStudio("agent.tool_call", {
      callId: `call-${Date.now()}`,
      tool,
      arguments: parsed,
    });
  } catch (error) {
    console.log(`Invalid JSON arguments: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
