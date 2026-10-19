import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db, mutate } from "../src/lib/db";
import { createEvent } from "../src/lib/domain";
import { challenge } from "../src/lib/connection-auth";
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
let clientId = "",
  authKey = "",
  c: Client | undefined;
const resource = `${base}/api/e/${slug}/mcp`,
  redirect = "http://127.0.0.1:4567/callback",
  verifier = "x".repeat(64);
const send = (url: string, body: unknown, cookie = "") =>
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: base,
    },
    body: JSON.stringify(body),
  });
try {
  const challengeResponse = await send(resource, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  assert.equal(challengeResponse.status, 401);
  assert.match(
    challengeResponse.headers.get("www-authenticate")!,
    /resource_metadata/,
  );
  const meta = await (
    await fetch(`${base}/.well-known/oauth-authorization-server`)
  ).json();
  const reg = await send(meta.registration_endpoint, {
    client_name: "Connection smoke test",
    redirect_uris: [redirect],
    token_endpoint_auth_method: "none",
  });
  assert.equal(reg.status, 201);
  clientId = (await reg.json()).client_id;
  const auth = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge(verifier),
    resource,
    state: "test-state",
    scope: "room",
  }))
    auth.searchParams.set(k, v);
  const r = await fetch(auth, { redirect: "manual" });
  assert.equal(r.status, 302);
  const browserCookie = r.headers.get("set-cookie")!.split(";")[0];
  authKey = new URL(r.headers.get("location")!).searchParams.get("request")!;
  const request = await fetch(
    `${base}/api/connect/request?request=${authKey}`,
    { headers: { Cookie: browserCookie } },
  );
  assert.equal(request.status, 200);
  assert.equal(
    (
      await send(`${base}/api/connect/approve`, {
        request: authKey,
        consent: true,
      })
    ).status,
    403,
  );
  const approved = await send(
    `${base}/api/connect/approve`,
    {
      request: authKey,
      consent: true,
      brief: {
        human: "Test attendee",
        agent: "Test existing agent",
        building: "Community tools",
        experiences:
          "Tried to buy office supplies; checkout blocked; no purchase completed.",
        ask: "Feedback",
        offer: "Design",
      },
    },
    browserCookie,
  );
  assert.equal(approved.status, 200);
  const guestCookie = approved.headers
    .get("set-cookie")!
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`guest_${slug}=`))!
    .split(";")[0];
  const callback = new URL((await approved.json()).url);
  assert.equal(callback.searchParams.get("state"), "test-state");
  const grant = {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    code: callback.searchParams.get("code"),
    code_verifier: verifier,
    resource,
  };
  assert.equal(
    (
      await send(meta.token_endpoint, {
        ...grant,
        code_verifier: "z".repeat(64),
      })
    ).status,
    400,
  );
  const tokenResponse = await send(meta.token_endpoint, grant);
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()).access_token;
  assert.equal((await send(meta.token_endpoint, grant)).status, 400);
  c = new Client({ name: "Real SDK test", version: "1.0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const roomStatus = await c.callTool({ name: "room_status", arguments: {} });
  assert.match(
    JSON.stringify(roomStatus),
    /Tried to buy office supplies; checkout blocked/,
  );
  const tools = await c.listTools();
  assert.ok(tools.tools.some((t) => t.name === "post_message"));
  const posted = await c.callTool({
    name: "post_message",
    arguments: {
      text: "Hello from my own agent over MCP.",
      clientId: "connection-message-1",
    },
  });
  assert.ok(!posted.isError);
  const feed = await c.callTool({
    name: "read_messages",
    arguments: { after: 0 },
  });
  assert.match(JSON.stringify(feed), /Hello from my own agent/);
  const foreignReq = await fetch(`${base}/api/e/${other}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreignReq.status, 401);
  await mutate(slug, (e) => {
    e.paused = true;
  });
  assert.equal(
    (
      await c.callTool({
        name: "post_message",
        arguments: {
          text: "Must not post while paused",
          clientId: "connection-message-2",
        },
      })
    ).isError,
    true,
  );
  await mutate(slug, (e) => {
    e.paused = false;
  });
  assert.equal(
    (await send(`${base}/api/e/${slug}/browser-connect`, {}, guestCookie))
      .status,
    200,
  );
  assert.equal(
    (
      await send(
        `${base}/api/e/${slug}/browser-post`,
        { text: "Browser reply", clientId: "connection-browser-1" },
        guestCookie,
      )
    ).status,
    429,
  );
  await mutate(slug, (e) => {
    e.participants[0].lastPost = 0;
  });
  assert.equal(
    (
      await send(
        `${base}/api/e/${slug}/browser-post`,
        { text: "Browser reply", clientId: "connection-browser-1" },
        guestCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await send(`${base}/api/e/${slug}/disconnect`, {}, guestCookie)).status,
    200,
  );
  assert.equal(
    (
      await send(
        `${base}/api/e/${slug}/browser-post`,
        { text: "Disconnected", clientId: "connection-browser-2" },
        guestCookie,
      )
    ).status,
    403,
  );
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
  assert.equal(
    invoke("register", {
      human: "CLI attendee",
      agent: "Existing CLI agent",
      building: "Meetup tools",
      ask: "Feedback",
      offer: "Testing",
      consent: true,
    }).connected,
    true,
  );
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
    "PASS: SDK MCP discovery, OAuth consent/PKCE/replay isolation, automatic admission, read/post, pause, room isolation, browser posting, rate limits and disconnect.",
  );
} finally {
  await c?.close();
  await rm(clientDir, { recursive: true, force: true });
  await db()`delete from meetup_events where slug in (${slug},${other})`;
  if (clientId)
    await db()`delete from meetup_connections where key=${`client:${clientId}`} or data->>'client'=${clientId}`;
  await db().end();
}
