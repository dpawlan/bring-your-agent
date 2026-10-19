import { cookies } from "next/headers";
import { z } from "zod";
import {
  challenge,
  roomFromResource,
  validRedirect,
  type Authorization,
} from "@/lib/connection-auth";
import {
  saveConnection,
  getConnection,
  consumeConnection,
  connectionRateLimit,
} from "@/lib/connection-store";
import { AppError, hash, secret, onboard, participant } from "@/lib/domain";
import { mutate, readEvent } from "@/lib/db";
import { cookie, origin, error } from "@/lib/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ op: string }> };
const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
export async function GET(req: Request, ctx: Context) {
  try {
    const { op } = await ctx.params;
    const u = new URL(req.url);
    if (op === "authorize") {
      await connectionRateLimit(
        hash(`authorize:${req.headers.get("x-forwarded-for") || "local"}`),
        60,
      );
      const client = z.string().min(1).parse(u.searchParams.get("client_id"));
      const c = await getConnection<{ redirects: string[]; name: string }>(
        `client:${client}`,
      );
      const redirect = u.searchParams.get("redirect_uri") || "";
      if (!c.redirects.includes(redirect))
        throw new AppError(
          400,
          "Redirect URL does not match the registered client.",
        );
      if (
        u.searchParams.get("response_type") !== "code" ||
        u.searchParams.get("code_challenge_method") !== "S256"
      )
        throw new AppError(
          400,
          "Authorization code with PKCE S256 is required.",
        );
      const proof = z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .parse(u.searchParams.get("code_challenge"));
      if (u.searchParams.get("scope") && u.searchParams.get("scope") !== "room")
        throw new AppError(400, "Only room access is supported.");
      const resource = u.searchParams.get("resource") || "";
      const event = roomFromResource(resource, u.origin);
      const e = await readEvent(event);
      if (e.status === "closed")
        throw new AppError(409, "This meetup has closed.");
      const id = secret(),
        browser = secret();
      await saveConnection(`auth:${id}`, {
        client,
        redirect,
        resource,
        event,
        challenge: proof,
        state: (u.searchParams.get("state") || "").slice(0, 2000),
        browserHash: hash(browser),
        name: c.name,
      });
      (await cookies()).set(`connect_${id}`, browser, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return Response.redirect(`${u.origin}/connect/authorize?request=${id}`);
    }
    if (op === "request") {
      const id = u.searchParams.get("request") || "";
      const a = await getConnection<Authorization>(`auth:${id}`);
      if (
        hash((await cookies()).get(`connect_${id}`)?.value || "") !==
        a.browserHash
      )
        throw new AppError(
          403,
          "Open authorization in the browser where you started it.",
        );
      const e = await readEvent(a.event);
      let brief;
      try {
        brief = participant(
          e,
          (await cookies()).get(`guest_${a.event}`)?.value || "",
          "guest",
        ).brief;
      } catch {}
      return Response.json(
        { name: a.name, event: e.name, slug: a.event, brief },
        { headers },
      );
    }
    throw new AppError(404, "Unknown connection operation.");
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { op } = await ctx.params;
    if (Number(req.headers.get("content-length") || 0) > 16000)
      throw new AppError(413, "Request too large.");
    await connectionRateLimit(
      hash(`${op}:${req.headers.get("x-forwarded-for") || "local"}`),
      op === "register" ? 20 : 60,
    );
    const body = req.headers
      .get("content-type")
      ?.includes("application/x-www-form-urlencoded")
      ? Object.fromEntries(await req.formData())
      : await req.json();
    if (op === "register") {
      const d = z
        .object({
          client_name: z.string().max(100).default("Your agent"),
          redirect_uris: z.array(z.string().url().max(2000)).min(1).max(5),
          token_endpoint_auth_method: z.literal("none").optional(),
        })
        .parse(body);
      d.redirect_uris.forEach(validRedirect);
      const id = secret();
      await saveConnection(
        `client:${id}`,
        { name: d.client_name, redirects: d.redirect_uris },
        30 * 86400000,
      );
      return Response.json(
        {
          client_id: id,
          client_name: d.client_name,
          redirect_uris: d.redirect_uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        },
        { status: 201, headers },
      );
    }
    if (op === "approve") {
      origin(req);
      const id = z.string().parse(body.request);
      const a = await getConnection<Authorization>(`auth:${id}`);
      if (
        hash((await cookies()).get(`connect_${id}`)?.value || "") !==
        a.browserHash
      )
        throw new AppError(403, "Connection session mismatch.");
      if (body.consent !== true)
        throw new AppError(
          400,
          "Permission is required to connect your agent.",
        );
      const previous = (await cookies()).get(`guest_${a.event}`)?.value;
      const p = await mutate(a.event, (e) => {
        if (e.status === "closed")
          throw new AppError(409, "This meetup has closed.");
        if (previous) {
          try {
            const p = participant(e, previous, "guest");
            return { id: p.id };
          } catch {}
        }
        const r = onboard(e, {
          ...body.brief,
          mode: "external",
          consent: true,
        });
        return { id: r.p.id, token: r.token };
      });
      await consumeConnection(`auth:${id}`);
      if (p.token) await cookie(`guest_${a.event}`, p.token);
      const code = secret();
      await saveConnection(
        `code:${hash(code)}`,
        { ...a, participantId: p.id },
        60000,
      );
      (await cookies()).delete(`connect_${id}`);
      const redirect = new URL(a.redirect);
      redirect.searchParams.set("code", code);
      if (a.state) redirect.searchParams.set("state", a.state);
      return Response.json({ url: redirect.toString() }, { headers });
    }
    if (op === "token") {
      const d = z
        .object({
          grant_type: z.literal("authorization_code"),
          code: z.string(),
          client_id: z.string(),
          redirect_uri: z.string(),
          code_verifier: z
            .string()
            .min(43)
            .max(128)
            .regex(/^[A-Za-z0-9._~-]+$/),
          resource: z.string().optional(),
        })
        .parse(body);
      const key = `code:${hash(d.code)}`;
      const a = await getConnection<Authorization & { participantId: string }>(
        key,
      );
      if (
        a.client !== d.client_id ||
        a.redirect !== d.redirect_uri ||
        a.challenge !== challenge(d.code_verifier) ||
        (d.resource && d.resource !== a.resource)
      )
        throw new AppError(400, "Invalid authorization grant.");
      await consumeConnection(key);
      const token = secret();
      await mutate(a.event, (e) => {
        const p = e.participants.find((p) => p.id === a.participantId);
        if (!p || p.status !== "admitted" || e.status === "closed")
          throw new AppError(403, "Registration is inactive.");
        p.agentHash = hash(token);
        p.joined = true;
        p.lastActivity = Date.now();
        p.connection = {
          provider: "mcp",
          status: "connected",
          detail: "Connected through room tools",
          updatedAt: Date.now(),
        };
      });
      return Response.json(
        {
          access_token: token,
          token_type: "Bearer",
          scope: "room",
        },
        { headers },
      );
    }
    throw new AppError(404, "Unknown connection operation.");
  } catch (e) {
    const r = error(e);
    if ((await ctx.params).op === "token")
      return Response.json(
        {
          error: "invalid_grant",
          error_description: "Authorization failed. Start a new connection.",
        },
        { status: r.status, headers },
      );
    return r;
  }
}
