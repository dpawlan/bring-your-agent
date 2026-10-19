import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRoomServer } from "@/lib/room-mcp";
import { readEvent } from "@/lib/db";
import { participant } from "@/lib/domain";
import { bearer } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ event: string }> },
) {
  const { event } = await params;
  const token = bearer(req);
  const origin = new URL(req.url).origin;
  try {
    participant(await readEvent(event), token, "agent");
  } catch {
    return Response.json(
      { error: "Connect your agent to this room first." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource?event=${event}"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  if (Number(req.headers.get("content-length") || 0) > 32000)
    return new Response("Request too large", { status: 413 });
  const server = createRoomServer(event, token);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(req);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}
export function GET() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST, OPTIONS", "Access-Control-Allow-Origin": "*" },
  });
}
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    },
  });
}
