import { test } from "node:test";
import assert from "node:assert/strict";
import {
  challenge,
  roomFromResource,
  validRedirect,
} from "../src/lib/connection-auth";
import { pallyArguments, pallyOutput } from "../src/lib/pally-protocol";
test("OAuth only accepts this server’s room resource and secure redirects", () => {
  assert.equal(
    roomFromResource(
      "https://meetup.example/api/e/test-room/mcp",
      "https://meetup.example",
    ),
    "test-room",
  );
  for (const url of [
    "https://evil.example/api/e/test-room/mcp",
    "https://meetup.example/api/e/test-room/mcp?token=secret",
    "https://meetup.example/api/e/test-room/state",
  ])
    assert.throws(() => roomFromResource(url, "https://meetup.example"));
  assert.equal(
    validRedirect("http://127.0.0.1:3456/callback"),
    "http://127.0.0.1:3456/callback",
  );
  for (const url of [
    "http://evil.example/callback",
    "javascript:alert(1)",
    "https://user:password@example.com/callback",
    "https://example.com/#token",
  ])
    assert.throws(() => validRedirect(url));
  assert.equal(
    challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});
test("Pally publishes only explicit structured meetup replies, never raw private chat", () => {
  assert.deepEqual(
    pallyOutput({
      content: [{ type: "text", text: '{"meetupMessage":"Hello room"}' }],
    }),
    { message: "Hello room", replyTo: undefined },
  );
  assert.equal(
    pallyOutput({ structuredContent: { meetupMessage: null } }).message,
    null,
  );
  assert.equal(
    pallyOutput({ structuredContent: { status: "pending", handle: "job-1" } })
      .pending,
    "job-1",
  );
  assert.throws(() =>
    pallyOutput({
      content: [{ type: "text", text: "Your bank balance is private" }],
    }),
  );
  assert.throws(() =>
    pallyOutput({ structuredContent: { meetupMessage: "x".repeat(501) } }),
  );
});
test("Pally adapter rejects unknown required tool arguments before sending", () => {
  assert.deepEqual(
    pallyArguments(
      {
        name: "message_pally",
        inputSchema: { properties: { message: {} }, required: ["message"] },
      },
      "hello",
      "message",
    ),
    { message: "hello" },
  );
  assert.throws(() =>
    pallyArguments(
      {
        name: "message_pally",
        inputSchema: {
          properties: { message: {}, account: {} },
          required: ["message", "account"],
        },
      },
      "hello",
      "message",
    ),
  );
});
