import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { db } = await import("../src/lib/db");
await db()`create table if not exists meetup_events(slug text primary key,data jsonb not null,delete_at timestamptz not null)`;
await db()`create index if not exists meetup_retention on meetup_events(delete_at)`;
await db()`create table if not exists meetup_connections(key text primary key,data jsonb not null,expires_at timestamptz not null)`;
await db()`create index if not exists meetup_connection_expiry on meetup_connections(expires_at)`;
await db().end();
console.log("Database migration complete.");
