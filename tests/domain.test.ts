import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEvent,
  onboard,
  admit,
  pair,
  exchange,
  participant,
  post,
  visibleMessages,
  useLinkAdmission,
} from "../src/lib/domain";
const brief = {
  human: "Maya",
  agent: "Atlas",
  building: "Accessible cities",
  ask: "Community research",
  offer: "Mapping",
  interests: "",
  mode: "external",
  consent: true,
};
function setup() {
  const e = createEvent("test", "Meetup", "host");
  e.status = "active";
  e.paused = false;
  const { p } = onboard(e, brief);
  admit(e, p);
  p.joined = true;
  return { e, p };
}
test("pairing is single-use; credentials are stored hashed", () => {
  const { e, p } = setup();
  const code = pair(e, p);
  assert.notEqual(p.pairHash, code);
  const token = exchange(e, code);
  assert.notEqual(p.agentHash, token);
  assert.equal(participant(e, token, "agent").id, p.id);
  assert.throws(() => exchange(e, code));
});
test("two independent agents exchange credentials, read and reply with retry deduplication", () => {
  const { e, p } = setup();
  e.moderation = "live";
  const other = onboard(e, { ...brief, human: "James", agent: "Orbit" }).p;
  admit(e, other);
  const a = exchange(e, pair(e, p)),
    b = exchange(e, pair(e, other));
  participant(e, b, "agent").joined = true;
  const m = post(e, participant(e, a, "agent"), {
    text: "Who works with communities?",
    clientId: "client-message-1",
  });
  const r = post(e, participant(e, b, "agent"), {
    text: "James can help.",
    replyTo: m.id,
    clientId: "client-message-2",
  });
  assert.equal(visibleMessages(e, m.cursor)[0].id, r.id);
  assert.equal(
    post(e, p, {
      text: "Who works with communities?",
      clientId: "client-message-1",
    }).id,
    m.id,
  );
  assert.equal(e.messages.length, 2);
});
test("pending and hidden messages cannot be read or replied to", () => {
  const { e, p } = setup();
  const m = post(e, p, { text: "Pending", clientId: "pending-one" });
  m.status = "pending";
  assert.equal(visibleMessages(e).length, 0);
  p.lastPost = 0;
  assert.throws(() =>
    post(e, p, { text: "Reply", replyTo: m.id, clientId: "reply-id-1" }),
  );
  m.status = "hidden";
  assert.equal(visibleMessages(e).length, 0);
});
test("pause and epoch reject in-flight output even after resume", () => {
  const { e, p } = setup();
  e.paused = true;
  assert.throws(() => post(e, p, { text: "No", clientId: "pause-id-1" }));
  e.paused = false;
  e.epoch++;
  assert.throws(() => post(e, p, { text: "Stale", clientId: "pause-id-2" }, 0));
});
test("limits and foreign replies enforced", () => {
  const { e, p } = setup();
  assert.throws(() =>
    post(e, p, { text: "a".repeat(501), clientId: "length-id" }),
  );
  assert.throws(() =>
    post(e, p, {
      text: "Reply",
      replyTo: "other-event-id",
      clientId: "foreign-id",
    }),
  );
  post(e, p, { text: "Hello", clientId: "hello-id-1" });
  assert.throws(() => post(e, p, { text: "Too soon", clientId: "hello-id-2" }));
  p.lastPost = 0;
  p.posts = 20;
  assert.throws(() =>
    post(e, p, { text: "Over quota", clientId: "hello-id-3" }),
  );
});
test("twenty-agent cap and 400-message session preserve unique ordering", () => {
  const e = createEvent("test", "Meetup", "host");
  e.status = "active";
  e.paused = false;
  e.moderation = "live";
  for (let i = 0; i < 20; i++) {
    const { p } = onboard(e, { ...brief, human: `Person ${i}` });
    admit(e, p);
    p.joined = true;
    for (let n = 0; n < 20; n++) {
      p.lastPost = 0;
      post(e, p, { text: `Post ${n}`, clientId: `agent-${i}-message-${n}` });
    }
  }
  assert.equal(e.messages.length, 400);
  assert.equal(new Set(e.messages.map((m) => m.cursor)).size, 400);
  assert.throws(() => onboard(e, brief), /room is full/);
});
test("viewing room stays live and closure rejects credentials", () => {
  const { e, p } = setup();
  e.moderation = "live";
  const token = exchange(e, pair(e, p));
  e.wall.frozen = true;
  e.wall.freezeCursor = e.cursor;
  post(e, p, { text: "New message", clientId: "freeze-id" });
  assert.equal(visibleMessages(e, 0, true).length, 1);
  assert.equal(visibleMessages(e).length, 1);
  e.status = "closed";
  assert.throws(() => participant(e, token, "agent"));
});

test("messages publish immediately even for legacy reviewed rooms", () => {
  const { e, p } = setup();
  e.moderation = "reviewed";
  assert.equal(
    post(e, p, { text: "Live message", clientId: "live-message-test" }).status,
    "published",
  );
});
test("app-created agents cannot register", () => {
  const { e } = setup();
  assert.throws(() => onboard(e, { ...brief, mode: "hosted" }));
});

test("invite registration is immediate and old pending guests recover without reviving revoked guests", () => {
  const e = createEvent("invite", "Meetup", "host");
  e.admission = "approval";
  const p = onboard(e, brief).p;
  assert.equal(p.status, "admitted");
  p.status = "pending";
  const revoked = onboard(e, { ...brief, human: "Revoked" }).p;
  revoked.status = "revoked";
  useLinkAdmission(e);
  assert.equal(p.status, "admitted");
  assert.equal(revoked.status, "revoked");
  assert.equal(e.admission, "link");
  assert.ok(pair(e, p));
});

test("approved purchasing summaries survive onboarding and stay optional for existing clients", () => {
  const e = createEvent("stories", "Stories", "host");
  const summary =
    "Tried to buy office supplies; compared options; checkout blocked; no purchase completed. Need help with checkout reliability.";
  onboard(e, { ...brief, experiences: summary });
  assert.equal(e.participants[0].brief.experiences, summary);
  onboard(e, brief);
  assert.equal(e.participants[1].brief.experiences, undefined);
  assert.throws(() => onboard(e, { ...brief, experiences: "x".repeat(1501) }));
});
