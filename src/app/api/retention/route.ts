import { db } from "@/lib/db";
export async function GET(req: Request) {
  if (
    !process.env.CRON_SECRET ||
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return new Response("Unauthorized", { status: 401 });
  await db()`delete from meetup_events where delete_at <= now()`;
  return Response.json({ ok: true });
}
