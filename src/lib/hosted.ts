import { Client } from "eve/client";
import { getVercelOidcToken } from "@vercel/oidc";
import { z } from "zod";
import { mutate, readEvent } from "./db";
import { post, reserveTurn, settle, visibleMessages } from "./domain";
const output = z.object({
  action: z.enum(["post", "skip", "introduction"]),
  text: z.string().max(500),
  replyTo: z.string().nullable(),
  people: z.array(z.string()).max(2),
  messageIds: z.array(z.string()).max(5),
});
export async function claim(slug: string, id: string) {
  "use step";
  return mutate(slug, (e) => {
    if (e.coordinator && e.coordinator !== id) return false;
    e.coordinator = id;
    return true;
  });
}
export async function runTurn(slug: string, id: string) {
  "use step";
  let reservation;
  try {
    const e = await readEvent(slug);
    if (e.status === "closed") return false;
    reservation = await mutate(slug, (e) => reserveTurn(e, id));
    if (!reservation) return true;
    const current = await readEvent(slug);
    if (
      current.paused ||
      current.status !== "active" ||
      !current.generationEnabled ||
      current.epoch !== reservation.epoch
    ) {
      await mutate(slug, (e) => settle(e, id, 0));
      return true;
    }
    const p = current.participants.find(
      (p) => p.id === reservation!.participantId,
    )!;
    const client = new Client({
      host:
        process.env.APP_URL ||
        `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      auth: { vercelOidc: { token: () => getVercelOidcToken() } },
      redirect: "error",
    });
    const session = p.eveSession
      ? client.sessions.attach(p.eveSession)
      : (await client.sessions.create()).session;
    if (!p.eveSession)
      await mutate(slug, (e) => {
        const person = e.participants.find((x) => x.id === p.id);
        if (person) person.eveSession = session.state.sessionId;
      });
    // Clear previous model history so moderation changes cannot leak hidden messages into later turns.
    if (p.eveSession) await session.clear();
    const response = await session.send<z.infer<typeof output>>(
      JSON.stringify({
        brief: p.brief,
        posts: p.posts,
        round: current.round,
        prompt: current.prompt,
        messages: visibleMessages(current)
          .slice(-18)
          .map(({ id, participantId, agent, human, text }) => ({
            id,
            participantId,
            agent,
            human,
            text,
          })),
      }),
      {
        outputSchema: output,
        signal: AbortSignal.timeout(90000),
      },
    );
    const result = await response.result();
    let cost = 0;
    let measured = false;
    for (const event of result.events) {
      if (
        event.type === "step.completed" &&
        typeof event.data.usage?.costUsd === "number"
      ) {
        cost += event.data.usage.costUsd;
        measured = true;
      }
    }
    await mutate(slug, (e) => {
      const r = e.reservations.find((r) => r.id === id);
      if (!r || r.settled) return;
      settle(e, id, measured ? cost : r.amount);
      const data = output.safeParse(result.data);
      const p = e.participants.find((p) => p.id === r.participantId);
      if (
        !p ||
        p.status !== "admitted" ||
        !data.success ||
        e.paused ||
        e.status !== "active" ||
        e.epoch !== r.epoch ||
        !e.generationEnabled ||
        e.spent > e.budget
      )
        return;
      if (data.data.action === "post") {
        try {
          post(
            e,
            p,
            {
              text: data.data.text,
              clientId: id,
              replyTo: data.data.replyTo || undefined,
            },
            r.epoch,
          );
        } catch {
          /* A race with moderation or another post intentionally drops this output. */
        }
      }
      if (
        data.data.action === "introduction" &&
        data.data.people.length === 2 &&
        data.data.messageIds.length > 0 &&
        data.data.people.every((pid) =>
          e.participants.some((p) => p.id === pid && p.status === "admitted"),
        ) &&
        data.data.messageIds.every((mid) =>
          e.messages.some((m) => m.id === mid && m.status === "published"),
        )
      ) {
        e.suggestionDrafts.push({
          id,
          people: data.data.people,
          reason: data.data.text,
          messageIds: data.data.messageIds,
        });
      }
    });

    return true;
  } catch {
    if (reservation)
      await mutate(slug, (e) => {
        settle(e, id, reservation!.amount);
        e.generationEnabled = false;
        e.coordinator = undefined;
        e.audit.push({
          at: Date.now(),
          actor: "coordinator",
          action:
            "Hosted generation stopped after provider failure. Reserved estimate retained.",
        });
      }).catch(() => {});
    return false;
  }
}
runTurn.maxRetries = 0;

export async function release(slug: string, id: string) {
  "use step";
  await mutate(slug, (e) => {
    if (e.coordinator === id) e.coordinator = undefined;
  }).catch(() => {});
}
