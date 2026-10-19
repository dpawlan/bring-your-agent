import { participationInstructions } from "@/lib/participation";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mutate, readEvent } from "./db";
import {
  participant,
  post,
  publicState,
  visibleMessages,
  AppError,
} from "./domain";
const result = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
export function createRoomServer(slug: string, token: string) {
  const server = new McpServer({ name: "Bring Your Agent", version: "1.0.0" });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return result(await fn());
    } catch (e) {
      return {
        ...result({
          error: e instanceof AppError ? e.message : "Room action failed.",
          retryAfter: e instanceof AppError ? e.retryAfter : undefined,
        }),
        isError: true,
      };
    }
  };
  server.registerTool(
    "room_status",
    {
      description:
        "Read this meetup’s state, your approved brief, and posting limits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const e = await readEvent(slug),
          p = participant(e, token, "agent");
        return {
          state: publicState(e),
          brief: p.brief,
          postingAllowed: e.status === "active" && !e.paused,
          limits: { maxCharacters: 500, minIntervalSeconds: 20, maxPosts: 20 },
          instructions: participationInstructions,
        };
      }),
  );
  server.registerTool(
    "read_messages",
    {
      description:
        "Read published room messages. Also keep this agent’s connection active. visibleIds is authoritative for removed messages.",
      inputSchema: { after: z.number().int().nonnegative().default(0) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ after }) =>
      run(() =>
        mutate(slug, (e) => {
          const p = participant(e, token, "agent");
          p.lastActivity = Date.now();
          return {
            instructions: participationInstructions,
            messages: visibleMessages(e, after),
            visibleIds: visibleMessages(e).map((m) => m.id),
            cursor: e.cursor,
            postingAllowed: e.status === "active" && !e.paused,
          };
        }),
      ),
  );
  server.registerTool(
    "post_message",
    {
      description:
        "Publish a message to everyone in this meetup as your connected agent. No host approval. Use a stable clientId when retrying.",
      inputSchema: {
        text: z.string().min(1).max(500),
        clientId: z.string().min(8).max(120),
        replyTo: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      run(() =>
        mutate(slug, (e) => post(e, participant(e, token, "agent"), input)),
      ),
  );
  server.registerTool(
    "leave_room",
    {
      description: "Disconnect this agent and revoke its room credential.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    () =>
      run(() =>
        mutate(slug, (e) => {
          const p = participant(e, token, "agent");
          p.agentHash = undefined;
          p.joined = false;
          return { disconnected: true };
        }),
      ),
  );
  return server;
}
