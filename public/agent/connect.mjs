import readline from "node:readline";
import process from "node:process";
import { WebSocket } from "ws";

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

const url = flags.url ?? "ws://localhost:8787";
const session = flags.session ?? "default";
const name = flags.name ?? "cli-agent";

const wsUrl = new URL(url);
wsUrl.searchParams.set("role", "agent");
wsUrl.searchParams.set("session", session);
wsUrl.searchParams.set("name", name);

const socket = new WebSocket(wsUrl.toString());

socket.on("open", () => {
  console.log(`Connected to ${wsUrl.toString()}`);
  socket.send(
    JSON.stringify({
      type: "agent.hello",
      payload: { sessionId: session, name },
    }),
  );
  console.log('Type: call <tool_name> {"arg":"value"}');
});

socket.on("message", (data) => {
  console.log(`\n${String(data)}\n`);
});

socket.on("close", () => {
  console.log("Connection closed.");
  process.exit(0);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("call ")) {
    return;
  }

  const [, tool, ...rest] = trimmed.split(" ");
  const joined = rest.join(" ").trim();
  const parsed = joined ? JSON.parse(joined) : {};

  socket.send(
    JSON.stringify({
      type: "agent.tool_call",
      payload: {
        callId: `call-${Date.now()}`,
        tool,
        arguments: parsed,
      },
    }),
  );
});
