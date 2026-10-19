import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, mutate } from "../src/lib/db";
import { createEvent, hash } from "../src/lib/domain";
const slug = "verification-" + randomUUID().slice(0, 8),
  base = "https://bring-your-agent.vercel.app";
const e = createEvent(
  slug,
  "Automated verification (temporary)",
  "verification",
);
e.admission = "approval";
e.entryHash = hash("test-entry-code");
e.status = "active";
e.paused = false;
e.moderation = "reviewed"; // Legacy rooms must also publish immediately.
await db()`insert into meetup_events(slug,data,delete_at) values(${slug},${db().json(e)},${new Date(e.deleteAt)})`;
async function call(
  op: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(`${base}/api/e/${slug}/${op}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
try {
  const spec = await (await fetch(`${base}/e/${slug}/agent.json`)).json();
  assert.equal(spec.version, "1.4");
  assert.equal(spec.connections.preferred, "api");
  assert.equal(spec.endpoints.onboard.method, "POST");
  assert.equal(spec.endpoints.me.method, "GET");
  assert.equal(spec.endpoints.pair.method, "POST");
  assert.ok(spec.registration.instructions.length);
  const rejected = await call("onboard", {
    human: "No hosted agents",
    agent: "Hosted",
    building: "Test",
    ask: "Test",
    offer: "Test",
    interests: "",
    mode: "hosted",
    consent: true,
    code: "test-entry-code",
  });
  assert.equal(rejected.status, 400);
  const clients = [];
  for (const name of ["Test Atlas", "Test Orbit"]) {
    const joined = await call("onboard", {
      human: name,
      agent: name,
      building: "Accessible cities",
      ask: "Community feedback",
      offer: "Mapping",
      interests: "",
      mode: "external",
      consent: true,
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.status, "admitted");
    await mutate(slug, (room) => {
      room.participants.at(-1)!.status = "pending";
    });
    const me = await call("me", undefined, { Cookie: joined.cookie! });
    assert.equal(me.data.status, "admitted");
    const paired = await call("pair", {}, { Cookie: joined.cookie! });
    assert.equal(paired.status, 200);
    const ex = await call("exchange", { code: paired.data.code });
    assert.equal(ex.status, 200);
    const h = { Authorization: `Bearer ${ex.data.credential}` };
    assert.equal((await call("join", {}, h)).status, 200);
    assert.equal(
      (await call("exchange", { code: paired.data.code })).status,
      401,
    );
    clients.push(h);
  }
  const a = await call(
    "post",
    { text: "Who works with communities?", clientId: "smoke-message-a" },
    clients[0],
  );
  assert.equal(a.status, 200);
  const b = await call(
    "post",
    {
      text: "I can help with mapping.",
      clientId: "smoke-message-b",
      replyTo: a.data.id,
    },
    clients[1],
  );
  assert.equal(b.status, 200);
  assert.equal(
    (
      await call(
        "post",
        { text: "Retry", clientId: "smoke-message-a" },
        clients[0],
      )
    ).data.id,
    a.data.id,
  );
  const feed = await call("messages", undefined, clients[0]);
  assert.equal(feed.data.messages.length, 2);
  assert.equal(feed.data.canManage, false);
  assert.equal(feed.data.state.wall.showJoinLink, true);
  assert.ok(
    [401, 403].includes(
      (await call("control", { action: "join-link", value: false }, clients[0]))
        .status,
    ),
  );
  await mutate(slug, (e) => {
    e.wall.showJoinLink = false;
  });
  assert.equal(
    (await call("messages", undefined, clients[1])).data.state.wall
      .showJoinLink,
    false,
  );
  assert.equal(
    (await call("messages?view=wall", undefined, clients[1])).data.state.wall
      .showJoinLink,
    false,
  );
  await mutate(slug, (e) => {
    e.wall.showJoinLink = true;
  });
  assert.equal(
    (await call("messages", undefined, clients[0])).data.state.wall
      .showJoinLink,
    true,
  );
  assert.ok([401, 403].includes((await call("messages")).status));
  await mutate(slug, (e) => {
    e.messages[0].status = "hidden";
    e.paused = true;
  });
  assert.equal(
    (await call("messages", undefined, clients[1])).data.messages.length,
    1,
  );
  assert.equal(
    (
      await call(
        "post",
        { text: "Paused", clientId: "smoke-message-c" },
        clients[0],
      )
    ).status,
    409,
  );
  console.log(
    "PASS: two production HTTP clients, admission, pairing, read/reply, idempotency, immediate publication, hosted-agent rejection, unauthorized reads, pause, join-display sync and guest control denial.",
  );
} finally {
  await db()`delete from meetup_events where slug=${slug}`;
  await db().end();
}
