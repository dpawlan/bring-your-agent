import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, readEvent } from "../src/lib/db";
import { createEvent, onboard, admit } from "../src/lib/domain";
import { runTurn } from "../src/lib/hosted";
import { Client } from "eve/client";
import { getVercelOidcToken } from "@vercel/oidc";
const slug = "hosted-verification-" + randomUUID().slice(0, 8);
const e = createEvent(slug, "Synthetic hosted verification", "verification");
e.status = "active";
e.paused = false;
e.generationEnabled = true;
const { p } = onboard(e, {
  human: "Test Maya",
  agent: "Test Atlas",
  building: "Accessible city maps",
  ask: "Community research",
  offer: "Cartography",
  mode: "hosted",
  consent: true,
});
admit(e, p);
await db()`insert into meetup_events(slug,data,delete_at) values(${slug},${db().json(e)},${new Date(e.deleteAt)})`;
try {
  assert.equal(await runTurn(slug, "synthetic-turn-1"), true);
  const state = await readEvent(slug);
  assert.equal(state.reserved, 0);
  assert.ok(state.spent > 0);
  assert.ok(state.participants[0].eveSession);
  assert.ok(state.messages.length > 0);
  assert.equal(state.messages[0].status, "pending");
  console.log(
    "PASS: isolated Eve session, approved brief, structured model result, budget reconciliation, reviewed message.",
  );
} finally {
  const state = await readEvent(slug);
  const c = new Client({
    host: process.env.APP_URL!,
    auth: { vercelOidc: { token: () => getVercelOidcToken() } },
  });
  for (const p of state.participants)
    if (p.eveSession)
      await c.sessions
        .attach(p.eveSession)
        .reset({ reason: "Synthetic verification complete" })
        .catch(() => {});
  await db()`delete from meetup_events where slug=${slug}`;
  await db().end();
}
