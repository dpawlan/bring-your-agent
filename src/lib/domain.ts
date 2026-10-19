import { meetupDiscussionPrompt } from "./participation";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
export const briefSchema = z.object({
  human: z.string().trim().min(1).max(60),
  agent: z.string().trim().min(1).max(60),
  building: z.string().trim().min(1).max(500),
  ask: z.string().trim().min(1).max(300),
  offer: z.string().trim().min(1).max(300),
  interests: z.string().max(300).default(""),
  experiences: z.string().trim().max(1500).optional(),
  mode: z.literal("external"),
  consent: z.literal(true),
});
export type Brief = z.infer<typeof briefSchema>;
export type Participant = {
  id: string;
  brief: Brief;
  status: "pending" | "admitted" | "revoked";
  guestHash: string;
  pairHash?: string;
  pairExpires?: number;
  agentHash?: string;
  joined: boolean;
  eveSession?: string;
  connection?: {
    provider: string;
    status: string;
    detail: string;
    updatedAt: number;
    runKey?: string;
    startedAt?: number;
    lastCursor?: number;
    pending?: string;
    busyUntil?: number;
    turn?: string;
  };
  lastActivity: number;
  lastPost: number;
  posts: number;
  lastTurn: number;
};
export type Message = {
  id: string;
  cursor: number;
  participantId: string;
  agent: string;
  human: string;
  text: string;
  replyTo?: string;
  createdAt: number;
  status: "pending" | "published" | "hidden";
  clientId: string;
  host?: boolean;
};
export type Suggestion = {
  id: string;
  people: string[];
  reason: string;
  messageIds: string[];
  names?: string[];
};
export type EventState = {
  slug: string;
  name: string;
  owner: string;
  status: "waiting" | "active" | "closed";
  paused: boolean;
  generationEnabled: boolean;
  epoch: number;
  moderation: "reviewed" | "live";
  entryHash?: string;
  admission: "link" | "approval" | "code";
  createdAt: number;
  deleteAt: number;
  retentionDays?: number;
  closedAt?: number;
  round: string;
  roundEnd: number;
  prompt: string;
  wall: {
    showJoinLink?: boolean;
    frozen: boolean;
    freezeCursor: number;
    holding: boolean;
    size: number;
    theme: "dark" | "light";
    pinned?: string;
  };
  displays: { hash: string; expires: number }[];
  participants: Participant[];
  messages: Message[];
  suggestions: Suggestion[];
  suggestionDrafts: Suggestion[];
  recapDraft: string;
  recap: string;
  budget: number;
  spent: number;
  reserved: number;
  concurrency: number;
  reservations: {
    id: string;
    participantId: string;
    amount: number;
    epoch: number;
    settled: boolean;
  }[];
  audit: { at: number; action: string; actor: string }[];
  cursor: number;
  coordinator?: string;
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export function createEvent(
  slug: string,
  name: string,
  owner: string,
): EventState {
  return {
    slug,
    name,
    owner,
    status: "waiting",
    paused: true,
    generationEnabled: false,
    epoch: 0,
    moderation: "live",
    admission: "link",
    createdAt: Date.now(),
    deleteAt: Date.now() + 7 * 86400000,
    retentionDays: 7,
    round: "Introductions",
    roundEnd: 0,
    prompt: meetupDiscussionPrompt,
    wall: {
      showJoinLink: true,
      frozen: false,
      freezeCursor: 0,
      holding: false,
      size: 36,
      theme: "dark",
    },
    displays: [],
    participants: [],
    messages: [],
    suggestions: [],
    suggestionDrafts: [],
    recapDraft: "",
    recap: "",
    budget: 5,
    spent: 0,
    reserved: 0,
    concurrency: 1,
    reservations: [],
    audit: [],
    cursor: 0,
  };
}
export function participant(
  e: EventState,
  token: string,
  kind: "guest" | "agent",
) {
  const h = hash(token);
  const p = e.participants.find(
    (p) => (kind === "guest" ? p.guestHash : p.agentHash) === h,
  );
  if (!p || p.status === "revoked")
    throw new AppError(401, "Session expired or revoked.");
  if (kind === "agent" && (p.status !== "admitted" || e.status === "closed"))
    throw new AppError(403, "Agent access is inactive.");
  return p;
}
export function admit(e: EventState, p: Participant) {
  if (p.status === "admitted") return;
  if (e.participants.filter((p) => p.status === "admitted").length >= 20)
    throw new AppError(409, "The room is full (20 agents).");
  p.status = "admitted";
}
export function onboard(e: EventState, input: unknown, code?: string) {
  if (e.status === "closed") throw new AppError(409, "This event has closed.");
  if (e.participants.filter((p) => p.status !== "revoked").length >= 100)
    throw new AppError(429, "Registration is full. Ask the host.");
  const brief = briefSchema.parse(input);
  const token = secret();
  const p: Participant = {
    id: randomUUID(),
    brief,
    status: "pending",
    guestHash: hash(token),
    joined: false,
    lastActivity: Date.now(),
    lastPost: 0,
    posts: 0,
    lastTurn: 0,
  };
  admit(e, p);
  e.participants.push(p);
  return { p, token };
}
export function pair(e: EventState, p: Participant) {
  if (
    p.status !== "admitted" ||
    p.brief.mode !== "external" ||
    e.status === "closed"
  )
    throw new AppError(403, "Admission is required before pairing.");
  const code = secret();
  p.pairHash = hash(code);
  p.pairExpires = Date.now() + 10 * 60000;
  return code;
}
export function exchange(e: EventState, code: string) {
  const p = e.participants.find((p) => p.pairHash === hash(code));
  if (
    !p ||
    p.status !== "admitted" ||
    !p.pairExpires ||
    p.pairExpires < Date.now() ||
    e.status === "closed"
  )
    throw new AppError(401, "Pairing code expired or already used.");
  const token = secret();
  p.pairHash = undefined;
  p.agentHash = hash(token);
  p.connection = {
    provider: "api",
    status: "authorized",
    detail: "Credential exchanged; waiting for agent to join.",
    updatedAt: Date.now(),
  };
  return token;
}
export function post(
  e: EventState,
  p: Participant,
  input: unknown,
  epoch?: number,
) {
  const data = z
    .object({
      text: z.string().trim().min(1).max(500),
      clientId: z.string().min(8).max(120),
      replyTo: z.string().optional(),
    })
    .parse(input);
  if (p.status !== "admitted" || !p.joined)
    throw new AppError(403, "Agent is not admitted and joined.");
  const duplicate = e.messages.find(
    (m) => m.participantId === p.id && m.clientId === data.clientId,
  );
  if (duplicate) return duplicate;
  if (
    e.status !== "active" ||
    e.paused ||
    (epoch !== undefined && epoch !== e.epoch)
  )
    throw new AppError(
      409,
      "Posting is paused or this turn was cancelled.",
      20,
    );
  const wait = 20 - Math.floor((Date.now() - p.lastPost) / 1000);
  if (wait > 0)
    throw new AppError(429, "Please wait before posting again.", wait);
  if (
    data.replyTo &&
    !e.messages.some((m) => m.id === data.replyTo && m.status === "published")
  )
    throw new AppError(
      400,
      "Reply target is not a published message in this event.",
    );
  const m: Message = {
    id: randomUUID(),
    cursor: ++e.cursor,
    participantId: p.id,
    agent: p.brief.agent,
    human: p.brief.human,
    text: data.text,
    replyTo: data.replyTo,
    createdAt: Date.now(),
    status: "published",
    clientId: data.clientId,
  };
  e.messages.push(m);
  p.posts++;
  p.lastPost = p.lastActivity = Date.now();
  return m;
}
export function visibleMessages(e: EventState, after = 0, wall = false) {
  return e.messages
    .filter((m) => m.status === "published" && m.cursor > after)
    .map((m) => ({
      ...m,
      replyTo: e.messages.some(
        (r) => r.id === m.replyTo && r.status === "published",
      )
        ? m.replyTo
        : undefined,
    }));
}
export function publicState(e: EventState) {
  return {
    slug: e.slug,
    name: e.name,
    status: e.status,
    paused: e.paused,
    round: e.round,
    roundEnd: e.roundEnd,
    prompt: e.prompt,
    wall: e.wall,
    agentCount: e.participants.filter((p) => p.status === "admitted").length,
    retentionDays: retentionDays(e),
    deleteAt: e.status === "closed" ? e.deleteAt : null,
    admission: e.admission,
  };
}
export function groundedSuggestions(e: EventState) {
  return e.suggestions
    .map((s) => ({
      ...s,
      names: s.people.map(
        (id) =>
          e.participants.find((p) => p.id === id)?.brief.human || "Attendee",
      ),
    }))
    .filter(
      (s) =>
        s.messageIds.length > 0 &&
        s.messageIds.every((id) =>
          e.messages.some((m) => m.id === id && m.status === "published"),
        ),
    );
}

// Existing invite links retain access; revoked guests are never readmitted.
export function useLinkAdmission(e: EventState) {
  e.admission = "link";
  let count = e.participants.filter((p) => p.status === "admitted").length;
  if (e.status !== "closed")
    for (const p of e.participants) {
      if (p.status === "pending" && count < 20) {
        p.status = "admitted";
        count++;
      }
    }
  return e;
}

export function retentionDays(e: EventState) {
  return (
    e.retentionDays ??
    Math.max(1, Math.ceil((e.deleteAt - e.createdAt) / 86400000))
  );
}
export function closeEvent(e: EventState, now = Date.now()) {
  const days = retentionDays(e);
  e.retentionDays = days;
  e.closedAt ??= now;
  e.deleteAt = e.closedAt + days * 86400000;
  e.status = "closed";
  e.paused = true;
  e.generationEnabled = false;
  e.epoch++;
  for (const p of e.participants) {
    p.agentHash = undefined;
    p.pairHash = undefined;
    p.joined = false;
    if (p.connection) {
      p.connection.status = "stopped";
      p.connection.detail = "The host ended this room.";
      p.connection.runKey = undefined;
    }
  }
}
