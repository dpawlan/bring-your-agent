import postgres from "postgres";
import { AppError, useLinkAdmission, type EventState } from "./domain";
let client: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!process.env.DATABASE_URL)
    throw new AppError(503, "Event storage is not configured yet.");
  return (client ??= postgres(process.env.DATABASE_URL, {
    max: 5,
    prepare: false,
  }));
}
export async function readEvent(slug: string) {
  const rows =
    await db()`select data from meetup_events where slug=${slug} and (data->>'status' <> 'closed' or delete_at > now())`;
  if (!rows[0])
    throw new AppError(404, "Event not found or retention period ended.");
  return useLinkAdmission(rows[0].data as EventState);
}
export async function mutate<T>(
  slug: string,
  fn: (e: EventState) => T,
): Promise<T> {
  return (await db().begin(async (tx) => {
    const rows =
      await tx`select data from meetup_events where slug=${slug} and (data->>'status' <> 'closed' or delete_at > now()) for update`;
    if (!rows[0]) throw new AppError(404, "Event not found.");
    const state = useLinkAdmission(rows[0].data as EventState);
    const result = fn(state);
    await tx`update meetup_events set data=${tx.json(state)},delete_at=${new Date(state.deleteAt)} where slug=${slug}`;
    return result;
  })) as T;
}
