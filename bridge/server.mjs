import http from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 8787);
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      studio: new Set(),
      agent: new Set(),
    });
  }

  return sessions.get(sessionId);
}

function getRoleSet(session, role) {
  return role === "studio" ? session.studio : session.agent;
}

function broadcast(targets, message) {
  const payload = JSON.stringify(message);
  for (const target of targets) {
    if (target.readyState === target.OPEN) {
      target.send(payload);
    }
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "printstudio-bridge" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const sessionId = url.searchParams.get("session") ?? "default";
  const role = url.searchParams.get("role") === "agent" ? "agent" : "studio";
  const name = url.searchParams.get("name") ?? role;
  const session = getSession(sessionId);
  const ownSet = getRoleSet(session, role);
  const peerSet = getRoleSet(session, role === "studio" ? "agent" : "studio");

  ownSet.add(socket);

  socket.send(
    JSON.stringify({
      type: "bridge.ready",
      payload: { sessionId, role, name },
    }),
  );

  broadcast(peerSet, {
    type: "peer.presence",
    payload: { sessionId, role, name, state: "connected" },
  });

  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw));
      broadcast(peerSet, data);
    } catch {
      socket.send(
        JSON.stringify({
          type: "bridge.error",
          payload: { message: "Invalid JSON payload" },
        }),
      );
    }
  });

  socket.on("close", () => {
    ownSet.delete(socket);
    broadcast(peerSet, {
      type: "peer.presence",
      payload: { sessionId, role, name, state: "disconnected" },
    });

    if (session.studio.size === 0 && session.agent.size === 0) {
      sessions.delete(sessionId);
    }
  });
});

server.listen(port, () => {
  console.log(`PrintStudio bridge listening on http://localhost:${port}`);
});
