import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db, mutate } from "../src/lib/db";
import { createEvent } from "../src/lib/domain";
const base = process.env.TEST_BASE || "http://localhost:3017";
const slug = "connections-" + randomUUID().slice(0, 8),
  other = slug + "-other";
const e = createEvent(slug, "Disposable connection test", "verification");
e.status = "active";
e.paused = false;
await db()`insert into meetup_events(slug,data,delete_at) values(${slug},${db().json(e)},${new Date(e.deleteAt)})`;
const foreign = createEvent(other, "Other test room", "verification");
await db()`insert into meetup_events(slug,data,delete_at) values(${other},${db().json(foreign)},${new Date(foreign.deleteAt)})`;
const clientDir = await mkdtemp(join(tmpdir(), "meetup-client-test-"));
const api = `${base}/api/e/${slug}`;
const send = (
  op: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${api}/${op}`, {
    method: "POST",
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const profile = (human: string) => ({
  human,
  agent: `${human}'s agent`,
  building: "Community tools",
  ask: "Feedback",
  offer: "Design",
  mode: "external",
  consent: true,
});
try {
  const spec = await (await fetch(`${base}/e/${slug}/agent.json`)).json();
  assert.equal(spec.version, "1.4");
  assert.equal(spec.connections.preferred, "api");
  assert.equal(spec.connections.browser.url, `${base}/e/${slug}/join`);
  assert.doesNotMatch(JSON.stringify(spec), /mcp|pally|oauth/i);
  assert.equal(
    (await fetch(`${base}/.well-known/oauth-authorization-server`)).status,
    404,
  );

  const onboarded = await send("onboard", profile("API attendee"));
  assert.equal(onboarded.status, 200);
  const guest = { Cookie: cookieOf(onboarded) };
  const pairing = await send("pair", undefined, guest);
  assert.equal(pairing.status, 200);
  const { code } = await pairing.json();
  const exchanged = await send("exchange", { code });
  assert.equal(exchanged.status, 200);
  const agent = {
    Authorization: `Bearer ${(await exchanged.json()).credential}`,
  };
  assert.equal((await send("exchange", { code })).status, 401);
  assert.equal((await send("join", undefined, agent)).status, 200);
  const state = await (await fetch(`${api}/state`, { headers: agent })).json();
  assert.equal(state.postingAllowed, true);
  assert.equal(state.round, "Introductions");
  const posted = await send(
    "post",
    { text: "Hello from my own agent over the API.", clientId: "api-1-abc" },
    agent,
  );
  assert.equal((await posted.json()).status, "published");
  const feed = await (
    await fetch(`${api}/messages?after=0`, { headers: agent })
  ).json();
  assert.match(JSON.stringify(feed.messages), /over the API/);
  assert.equal((await send("heartbeat", undefined, agent)).status, 200);
  assert.equal(
    (await fetch(`${base}/api/e/${other}/state`, { headers: agent })).status,
    401,
  );
  await mutate(slug, (e) => {
    e.paused = true;
    e.participants[0].lastPost = 0;
  });
  assert.equal(
    (await send("post", { text: "Paused", clientId: "api-2-abc" }, agent))
      .status,
    409,
  );
  await mutate(slug, (e) => {
    e.paused = false;
  });
  assert.equal((await send("leave", undefined, agent)).status, 200);
  assert.equal((await fetch(`${api}/state`, { headers: agent })).status, 401);
  const me = await (await fetch(`${api}/me`, { headers: guest })).json();
  assert.equal(me.connection.status, "disconnected");

  const browserGuest = {
    Cookie: cookieOf(await send("onboard", profile("Browser attendee"))),
  };
  const browserPost = (clientId: string) =>
    send("browser-post", { text: "Browser reply", clientId }, browserGuest);
  assert.equal((await browserPost("browser-1-abc")).status, 403);
  assert.equal(
    (await send("browser-connect", undefined, browserGuest)).status,
    200,
  );
  assert.equal((await browserPost("browser-1-abc")).status, 200);
  assert.equal((await browserPost("browser-2-abc")).status, 429);
  assert.equal((await send("disconnect", undefined, browserGuest)).status, 200);
  assert.equal((await browserPost("browser-3-abc")).status, 403);

  const invoke = (command: string, input?: unknown) => {
    const r = spawnSync(
      process.execPath,
      [resolve("public/agent-client.mjs"), command],
      {
        cwd: clientDir,
        env: { ...process.env, EVENT_URL: `${base}/e/${slug}` },
        input: input ? JSON.stringify(input) : undefined,
        encoding: "utf8",
        timeout: 45000,
      },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(invoke("register", profile("CLI attendee")).connected, true);
  assert.equal(
    (await stat(join(clientDir, ".meetup-connection.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(invoke("status").postingAllowed, true);
  assert.ok(invoke("read").messages.length >= 2);
  assert.equal(
    invoke("post", { text: "An actual reply supplied by the existing agent." })
      .status,
    "published",
  );
  assert.equal(invoke("leave").disconnected, true);
  console.log(
    "PASS: agent.json prefers the API, headless register/pair/join/post/leave without bodies or Origin, code replay, room isolation, pause, browser fallback with rate limits and disconnect, and the Node client.",
  );
} finally {
  await rm(clientDir, { recursive: true, force: true });
  await db()`delete from meetup_events where slug in (${slug},${other})`;
  await db().end();
}
