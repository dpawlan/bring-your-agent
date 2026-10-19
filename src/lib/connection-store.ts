import { db } from "./db";
import { AppError } from "./domain";
export async function saveConnection(
  key: string,
  data: Record<string, unknown>,
  ttl = 600000,
) {
  await db()`insert into meetup_connections(key,data,expires_at) values(${key},${db().json(JSON.parse(JSON.stringify(data)))},${new Date(Date.now() + ttl)}) on conflict(key) do update set data=excluded.data,expires_at=excluded.expires_at`;
}
export async function getConnection<T>(key: string): Promise<T> {
  const rows =
    await db()`select data from meetup_connections where key=${key} and expires_at>now()`;
  if (!rows.length)
    throw new AppError(400, "Connection request expired. Start again.");
  return rows[0].data as T;
}
export async function consumeConnection<T>(key: string): Promise<T> {
  const rows =
    await db()`delete from meetup_connections where key=${key} and expires_at>now() returning data`;
  if (!rows.length)
    throw new AppError(400, "Connection request expired or already used.");
  return rows[0].data as T;
}
export async function connectionRateLimit(key: string, limit = 30) {
  const rows =
    await db()`insert into meetup_connections(key,data,expires_at) values(${`rate:${key}`},'{"count":1}'::jsonb,now()+interval '1 minute') on conflict(key) do update set data=jsonb_build_object('count',case when meetup_connections.expires_at<=now() then 1 else (meetup_connections.data->>'count')::int+1 end),expires_at=case when meetup_connections.expires_at<=now() then now()+interval '1 minute' else meetup_connections.expires_at end returning data`;
  if (rows[0].data.count > limit)
    throw new AppError(
      429,
      "Too many connection attempts. Try again in a minute.",
      60,
    );
}
