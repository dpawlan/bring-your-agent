import {
  participationInstructions,
  getDiscussionGuide,
  roomLimits,
} from "@/lib/participation";
import { start } from "workflow/api";
import { pallyRelay } from "@/workflows/pally-relay";
import { pallyAuthorization, inspectPally, disconnectPally } from "@/lib/pally";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, mutate, readEvent } from "@/lib/db";
import {
  admit,
  AppError,
  createEvent,
  closeEvent,
  exchange,
  groundedSuggestions,
  hash,
  onboard,
  pair,
  participant,
  post,
  publicState,
  secret,
  visibleMessages,
} from "@/lib/domain";
import { bearer, cookie, error, host, origin, owner, reader } from "@/lib/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ event: string; op: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const { event, op } = await ctx.params;
    const e = await readEvent(event);
    if (op === "public")
      return Response.json({
        ...publicState(e),
        prompt: "",
        wall: undefined,
        pallyEnabled: process.env.PALLY_ENABLED === "true",
      });
    if (op === "me") {
      const guestToken = (await cookies()).get("guest_" + event)?.value || "";
      const p = participant(e, guestToken, "guest");
      if (p.status === "admitted" && e.status !== "closed")
        await cookie("guest_" + event, guestToken);
      return Response.json({
        brief: p.brief,
        connection: p.connection
          ? {
              provider: p.connection.provider,
              status: p.connection.status,
              detail: p.connection.detail,
              updatedAt: p.connection.updatedAt,
            }
          : undefined,
        id: p.id,
        status: p.status,
        joined: p.joined,
        lastActivity: p.lastActivity,
        posts: p.posts,
        suggestions:
          p.status === "admitted"
            ? groundedSuggestions(e).filter((s) => s.people.includes(p.id))
            : [],
      });
    }
    if (op === "host") {
      owner(e, await host());
      return Response.json({
        ...publicState(e),
        participants: e.participants.map(
          ({ id, brief, status, joined, lastActivity, posts }) => ({
            id,
            brief,
            status,
            joined,
            lastActivity,
            posts,
          }),
        ),
        messages: e.messages,
        recapDraft: e.recapDraft,
        suggestions: groundedSuggestions(e),
        suggestionDrafts: e.suggestionDrafts,
      });
    }
    const role = await reader(e, req);
    if (op === "state")
      return Response.json({
        ...publicState(e),
        instructions: participationInstructions,
        discussionGuide: getDiscussionGuide(e),
        limits: roomLimits,
        postingAllowed: e.status === "active" && !e.paused,
      });
    if (op === "messages") {
      const n = Number(new URL(req.url).searchParams.get("after") || 0);
      if (!Number.isSafeInteger(n) || n < 0)
        throw new AppError(400, "Invalid cursor.");
      return Response.json({
        messages: visibleMessages(
          e,
          n,
          role === "display" ||
            new URL(req.url).searchParams.get("view") === "wall",
        ),
        cursor: e.cursor,
        visibleIds: visibleMessages(
          e,
          0,
          role === "display" ||
            new URL(req.url).searchParams.get("view") === "wall",
        ).map((m) => m.id),
        instructions: participationInstructions,
        discussionGuide: getDiscussionGuide(e),
        canManage: role === "host",
        state: publicState(e),
        recap: e.recap,
      });
    }
    if (op === "recap")
      return Response.json({
        recap: e.recap,
        suggestions: groundedSuggestions(e),
      });
    if (op === "export") {
      owner(e, await host());
      return new Response(
        JSON.stringify(
          {
            event: e.name,
            messages: visibleMessages(e),
            recap: e.recap,
            suggestions: groundedSuggestions(e),
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${event}-transcript.json"`,
          },
        },
      );
    }
    throw new AppError(404, "Unknown operation.");
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    origin(req);
    const { event, op } = await ctx.params;
    if (!/^[a-z0-9-]{1,64}$/.test(event))
      throw new AppError(400, "Invalid event address.");
    if (Number(req.headers.get("content-length") || 0) > 16000)
      throw new AppError(413, "Request too large.");
    const raw = await req.text();
    if (raw.length > 16000) throw new AppError(413, "Request too large.");
    let body;
    try {
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new AppError(400, "Request body must be JSON.");
    }
    if (typeof body !== "object" || body === null)
      throw new AppError(400, "Request body must be a JSON object.");
    if (op === "create") {
      const id = await host();
      const data = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(body);
      const e = createEvent(event, data.name, id);
      await db()`insert into meetup_events(slug,data,delete_at) values(${event},${db().json(e)},${new Date(e.deleteAt)}) on conflict do nothing`;
      owner(await readEvent(event), id);
      return Response.json({ slug: event });
    }
    if (op === "onboard") {
      const previous = (await cookies()).get("guest_" + event)?.value;
      if (previous) {
        const existing = await readEvent(event);
        if (
          existing.participants.some(
            (p) => p.guestHash === hash(previous) && p.status !== "revoked",
          )
        )
          throw new AppError(
            409,
            "You already have an agent in this room. Open My agent.",
          );
      }

      const r = await mutate(event, (e) => onboard(e, body, body.code));
      await cookie("guest_" + event, r.token);
      return Response.json({ status: r.p.status });
    }
    if (op === "pair") {
      const token = (await cookies()).get("guest_" + event)?.value || "";
      return Response.json({
        code: await mutate(event, (e) =>
          pair(e, participant(e, token, "guest")),
        ),
      });
    }

    if (
      [
        "browser-connect",
        "browser-post",
        "disconnect",
        "pally-authorize",
        "pally-start",
      ].includes(op)
    ) {
      const token = (await cookies()).get("guest_" + event)?.value || "";
      const current = await readEvent(event);
      const guest = participant(current, token, "guest");
      if (guest.status !== "admitted" || current.status === "closed")
        throw new AppError(403, "This registration is inactive.");
      if (op === "pally-authorize")
        return Response.json({
          url: await pallyAuthorization(
            event,
            guest.id,
            new URL(req.url).origin,
          ),
        });
      if (op === "pally-start") {
        if (process.env.PALLY_ENABLED !== "true")
          throw new AppError(
            503,
            "Pally production authorization is not enabled yet.",
          );
        await inspectPally(event, guest.id);
        const key = secret();
        const started = await mutate(event, (e) => {
          const p = participant(e, token, "guest");
          if (p.connection?.runKey) return false;
          p.agentHash = undefined;
          p.joined = true;
          p.connection = {
            provider: "pally",
            status: "connected",
            detail:
              "Connected to your Pally. Listening for the meetup to start.",
            updatedAt: Date.now(),
            runKey: key,
            startedAt: Date.now(),
          };
          return true;
        });
        if (started) {
          try {
            await start(pallyRelay, [event, guest.id, key]);
          } catch {
            await mutate(event, (e) => {
              const p = participant(e, token, "guest");
              if (p.connection?.runKey === key) {
                p.connection.runKey = undefined;
                p.connection.status = "error";
                p.connection.detail = "Could not start listening. Try again.";
              }
            });
            throw new AppError(
              503,
              "Could not start the Pally relay. Try again.",
            );
          }
        }
        return Response.json({ connected: true });
      }
      if (op === "disconnect") {
        await mutate(event, (e) => {
          const p = participant(e, token, "guest");
          p.joined = false;
          p.agentHash = undefined;
          p.pairHash = undefined;
          p.connection = {
            provider: p.connection?.provider || "external",
            status: "disconnected",
            detail: "Disconnected by you.",
            updatedAt: Date.now(),
          };
        });
        if (guest.connection?.provider === "pally")
          await disconnectPally(event, guest.id);
        return Response.json({ disconnected: true });
      }
      return Response.json(
        await mutate(event, (e) => {
          const p = participant(e, token, "guest");
          if (op === "browser-post") {
            if (p.connection?.provider !== "browser")
              throw new AppError(403, "Connect browser participation first.");
            return post(e, p, body);
          }
          p.agentHash = undefined;
          p.joined = true;
          p.connection = {
            provider: "browser",
            status: "connected",
            detail:
              "Browser participation enabled. Your agent can post from My agent.",
            updatedAt: Date.now(),
          };
          return { connected: true };
        }),
      );
    }
    if (op === "exchange")
      return Response.json({
        credential: await mutate(event, (e) =>
          exchange(e, z.string().parse(body.code)),
        ),
        expires: "event-close",
      });
    if (["join", "post", "heartbeat", "leave"].includes(op)) {
      return Response.json(
        await mutate(event, (e) => {
          const p = participant(e, bearer(req), "agent");
          if (op === "post") return post(e, p, body);
          if (op === "leave") {
            p.agentHash = undefined;
            p.joined = false;
          } else {
            p.lastActivity = Date.now();
            if (op === "join") {
              p.joined = true;
              p.connection = {
                provider: "api",
                status: "connected",
                detail: "Agent connected through the room API.",
                updatedAt: Date.now(),
              };
            }
          }
          return { ok: true };
        }),
      );
    }
    const id = await host();
    if (op === "delete") {
      const e = await readEvent(event);
      owner(e, id);
      await db()`delete from meetup_events where slug=${event}`;
      return Response.json({ ok: true });
    }
    if (op === "control") {
      const result = await mutate(event, (e) => {
        owner(e, id);
        const action = z.string().parse(body.action);
        e.audit.push({ at: Date.now(), action, actor: id });
        const p = e.participants.find((p) => p.id === body.id);
        const m = e.messages.find((m) => m.id === body.id);
        switch (action) {
          case "concurrency":
            e.concurrency = z.number().int().min(1).max(3).parse(body.value);
            break;
          case "name":
            e.name = z.string().trim().min(1).max(100).parse(body.value);
            break;
          case "retention":
            e.retentionDays = z.number().int().min(1).max(30).parse(body.value);
            if (e.status === "closed")
              e.deleteAt =
                (e.closedAt ?? Date.now()) + e.retentionDays * 86400000;
            break;
          case "announcement": {
            const text = z.string().trim().min(1).max(500).parse(body.value);
            e.messages.push({
              id: randomUUID(),
              cursor: ++e.cursor,
              participantId: "host",
              agent: "Host",
              human: "Event host",
              text,
              createdAt: Date.now(),
              status: "published",
              clientId: randomUUID(),
              host: true,
            });
            break;
          }
          case "publish-suggestion": {
            const suggestion = e.suggestionDrafts.find((s) => s.id === body.id);
            if (
              !suggestion ||
              !suggestion.messageIds.every((id) =>
                e.messages.some((m) => m.id === id && m.status === "published"),
              )
            )
              throw new AppError(
                400,
                "Suggestion evidence is no longer published.",
              );
            e.suggestions.push(suggestion);
            e.suggestionDrafts = e.suggestionDrafts.filter(
              (s) => s.id !== body.id,
            );
            break;
          }
          case "admit":
            if (!p) throw new AppError(404, "Participant missing.");
            if (p.status !== "admitted") admit(e, p);
            break;
          case "revoke":
            if (p) {
              p.status = "revoked";
              p.agentHash = undefined;
              p.pairHash = undefined;
            }
            break;
          case "start":
            if (e.status === "closed")
              throw new AppError(409, "Closed events cannot restart.");
            e.status = "active";
            e.paused = false;
            e.roundEnd = Date.now() + 5 * 60000;
            break;
          case "pause":
            e.paused = Boolean(body.value);
            e.epoch++;
            break;
          case "join-link":
            e.wall.showJoinLink = z.boolean().parse(body.value);
            break;
          case "pin":
            e.wall.pinned = m?.status === "published" ? m.id : undefined;
            break;
          case "hide":
            if (m) {
              m.status = "hidden";
              e.cursor++;
              e.recap = "";
              e.recapDraft = "";
            }
            break;
          case "round":
            e.round = z
              .enum([
                "Introductions",
                "Discussion",
                "Connections",
                "Open discussion",
              ])
              .parse(body.value);
            e.roundEnd =
              Date.now() +
              (e.round === "Discussion"
                ? 15
                : e.round === "Connections"
                  ? 10
                  : 5) *
                60000;
            break;
          case "extend":
            e.roundEnd = Math.max(Date.now(), e.roundEnd) + 5 * 60000;
            break;
          case "prompt":
            e.prompt = z.string().trim().min(1).max(500).parse(body.value);
            break;
          case "close":
            closeEvent(e);
            break;
          case "draft-recap":
            e.recapDraft = visibleMessages(e)
              .map((m) => `${m.human} (${m.agent}): ${m.text} [${m.id}]`)
              .join("\n\n");
            break;
          case "publish-recap":
            e.recap = z.string().max(20000).parse(body.value);
            e.recapDraft = e.recap;
            break;
          case "suggestion": {
            const s = z
              .object({
                people: z.array(z.string()).length(2),
                reason: z.string().min(1).max(500),
                messageIds: z.array(z.string()).min(1),
              })
              .parse(body);
            if (
              !s.people.every((id) =>
                e.participants.some(
                  (p) => p.id === id && p.status === "admitted",
                ),
              ) ||
              !s.messageIds.every((id) =>
                e.messages.some((m) => m.id === id && m.status === "published"),
              )
            )
              throw new AppError(
                400,
                "Use admitted participants and published messages.",
              );
            e.suggestions.push({ id: randomUUID(), ...s });
            break;
          }
          default:
            throw new AppError(400, "Unknown host action.");
        }
        return { ok: true };
      });
      return Response.json(result);
    }
    throw new AppError(404, "Unknown operation.");
  } catch (e) {
    return error(e);
  }
}
