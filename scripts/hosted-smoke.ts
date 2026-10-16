import { Client } from "eve/client";
import { getVercelOidcToken } from "@vercel/oidc";
const c = new Client({
  host: "https://bring-your-agent.vercel.app",
  auth: { vercelOidc: { token: () => getVercelOidcToken() } },
  redirect: "error",
});
try {
  console.log("Health:", (await c.health()).status);
  const { session, response } = await c.sessions.create({
    message:
      "Approved brief: Test Maya builds accessible maps, wants community research, offers cartography. Introduction round. Output one short introduction.",
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.result();
  console.log("Hosted turn:", result.status, Boolean(result.message));
  for (const e of result.events)
    if (e.type === "step.failed" || e.type === "session.failed")
      console.log("Provider failure:", e.data.code);
  await session.reset({ reason: "Synthetic smoke test complete." });
} catch (e) {
  console.log(
    "Hosted smoke failure:",
    (e as Error).name,
    (e as Error).message.slice(0, 250),
  );
  process.exitCode = 1;
}
