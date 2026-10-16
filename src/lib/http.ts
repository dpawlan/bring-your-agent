import { cookies } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { AppError, hash, participant, type EventState } from "./domain";
export async function host() {
  if (!process.env.CLERK_SECRET_KEY)
    throw new AppError(503, "Host sign-in is not configured yet.");
  const { userId } = await auth();
  if (!userId) throw new AppError(401, "Sign in to continue.");
  const user = await currentUser();
  const allowedEmail = (process.env.HOST_EMAILS || "").toLowerCase().split(",");
  const emailMatch = user?.emailAddresses.some(
    (e) =>
      e.verification?.status === "verified" &&
      allowedEmail.includes(e.emailAddress.toLowerCase()),
  );
  if (
    !emailMatch &&
    !(process.env.HOST_USER_IDS || "").split(",").includes(userId)
  )
    throw new AppError(403, "This account is not an authorized event host.");
  return userId;
}
export function owner(e: EventState, id: string) {
  if (e.owner !== id)
    throw new AppError(403, "Only this event’s host can change it.");
}
export function bearer(req: Request) {
  return req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
}
export async function reader(e: EventState, req: Request) {
  const jar = await cookies();
  const display = jar.get("display_" + e.slug)?.value;
  if (
    display &&
    e.displays.some((d) => d.hash === hash(display) && d.expires > Date.now())
  )
    return "display";
  const token = jar.get("guest_" + e.slug)?.value;
  if (token) {
    const p = participant(e, token, "guest");
    if (p.status !== "admitted")
      throw new AppError(403, "Waiting for host admission.");
    return "guest";
  }
  if (bearer(req)) {
    participant(e, bearer(req), "agent");
    return "agent";
  }
  const id = await host();
  owner(e, id);
  return "host";
}
export async function cookie(name: string, value: string) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export function error(err: unknown) {
  if (err instanceof AppError)
    return Response.json(
      { error: err.message, retryAfter: err.retryAfter },
      {
        status: err.status,
        headers: err.retryAfter
          ? { "Retry-After": String(err.retryAfter) }
          : undefined,
      },
    );
  if (err instanceof Error && err.name === "ZodError")
    return Response.json(
      { error: "Please check the required fields and character limits." },
      { status: 400 },
    );
  console.error("Request failed:", err instanceof Error ? err.name : "unknown");
  return Response.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
export function origin(req: Request) {
  const o = req.headers.get("origin");
  if (o && o !== new URL(req.url).origin)
    throw new AppError(403, "Cross-site request rejected.");
}
