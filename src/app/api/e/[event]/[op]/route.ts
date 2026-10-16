import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, mutate, readEvent } from "@/lib/db";
import {
  admit,
  AppError,
  createEvent,
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
      return Response.json({ ...publicState(e), prompt: "", wall: undefined });
    if (op === "me") {
      const p = participant(
        e,
        (await cookies()).get("guest_" + event)?.value || "",
        "guest",
      );
      return Response.json({
        brief: p.brief,
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
        budget: e.budget,
        spent: e.spent,
        reserved: e.reserved,
        generationEnabled: e.generationEnabled,
        moderation: e.moderation,
        recapDraft: e.recapDraft,
        suggestions: groundedSuggestions(e),
        suggestionDrafts: e.suggestionDrafts,
      });
    }
    const role = await reader(e, req);
    if (op === "state")
      return Response.json({
        ...publicState(e),
        limits: { maxCharacters: 500, minIntervalSeconds: 20, maxPosts: 20 },
        postingAllowed: e.status === "active" && !e.paused,
      });
    if (op === "messages") {
      const n = Number(new URL(req.url).searchParams.get("after") || 0);
      if (!Number.isSafeInteger(n) || n < 0)
        throw new AppError(400, "Invalid cursor.");
      return Response.json({
        messages: visibleMessages(e, n, role === "display"),
        cursor: e.cursor,
        visibleIds: visibleMessages(e, 0, role === "display").map((m) => m.id),
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
    const body = await req.json();
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
    if (op === "switch-hosted") {
      const token = (await cookies()).get("guest_" + event)?.value || "";
      await mutate(event, (e) => {
        const p = participant(e, token, "guest");
        p.brief.mode = "hosted";
        p.agentHash = undefined;
        p.pairHash = undefined;
        p.joined = true;
      });
      return Response.json({ ok: true });
    }
    if (op === "pair") {
      const token = (await cookies()).get("guest_" + event)?.value || "";
      return Response.json({
        code: await mutate(event, (e) =>
          pair(e, participant(e, token, "guest")),
        ),
      });
    }
    if (op === "exchange")
      return Response.json({
        credential: await mutate(event, (e) =>
          exchange(e, z.string().parse(body.code)),
        ),
        expires: "event-close",
      });
    if (op === "display-pair") {
      const token = z.string().parse(body.code);
      const e = await readEvent(event);
      if (
        !e.displays.some(
          (d) => d.hash === hash(token) && d.expires > Date.now(),
        )
      )
        throw new AppError(401, "Display code invalid or expired.");
      await cookie("display_" + event, token);
      return Response.json({ ok: true });
    }
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
            if (op === "join") p.joined = true;
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
            e.deleteAt =
              e.createdAt +
              z.number().int().min(1).max(30).parse(body.value) * 86400000;
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
          case "generation":
            e.generationEnabled = Boolean(body.value);
            e.epoch++;
            break;
          case "freeze":
            e.wall.frozen = Boolean(body.value);
            e.wall.freezeCursor = e.cursor;
            break;
          case "holding":
            e.wall.holding = Boolean(body.value);
            break;
          case "size":
            e.wall.size = z.number().min(24).max(56).parse(body.value);
            break;
          case "theme":
            e.wall.theme = z.enum(["dark", "light"]).parse(body.value);
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
          case "approve":
            if (m?.status === "pending") {
              m.status = "published";
              m.cursor = ++e.cursor;
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
          case "moderation":
            e.moderation = z.enum(["reviewed", "live"]).parse(body.value);
            break;
          case "budget":
            e.budget = z
              .number()
              .min(e.spent + e.reserved)
              .max(100)
              .parse(body.value);
            break;
          case "entry":
            e.admission = body.value === "code" ? "code" : "approval";
            if (e.admission === "code")
              e.entryHash = hash(z.string().min(6).max(100).parse(body.code));
            break;
          case "display": {
            const code = secret();
            e.displays.push({
              hash: hash(code),
              expires: Date.now() + 12 * 3600000,
            });
            return { code };
          }
          case "revoke-displays":
            e.displays = [];
            break;
          case "close":
            e.status = "closed";
            e.paused = true;
            e.generationEnabled = false;
            e.epoch++;
            e.participants.forEach((p) => {
              p.agentHash = undefined;
              p.pairHash = undefined;
            });
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
    if (op === "coordinator") {
      const e = await readEvent(event);
      owner(e, id);
      const { start } = await import("workflow/api");
      const { coordinate } = await import("@/lib/coordinator");
      const run = await start(coordinate, [event]);
      return Response.json({ runId: run.runId });
    }
    throw new AppError(404, "Unknown operation.");
  } catch (e) {
    return error(e);
  }
}
