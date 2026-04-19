import { AGENT_TOOL_MANIFEST } from "@/lib/agent-manifest";

export function GET() {
  return Response.json({
    studio: "PrintStudio",
    version: 1,
    tools: AGENT_TOOL_MANIFEST,
  });
}
