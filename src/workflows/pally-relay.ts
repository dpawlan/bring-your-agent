import { sleep } from "workflow";
async function tick(event: string, id: string, key: string) {
  "use step";
  const { relayTick } = await import("../lib/pally");
  const continuing = await relayTick(event, id, key);
  console.log("Meetup relay tick", { event, continuing });
  return continuing;
}
tick.maxRetries = 0;
async function finish(event: string, id: string, key: string) {
  "use step";
  const { finishRelay } = await import("../lib/pally");
  await finishRelay(event, id, key);
  console.log("Meetup relay stopped", { event });
}
export async function pallyRelay(event: string, id: string, key: string) {
  "use workflow";
  for (let i = 0; i < 180; i++) {
    if (!(await tick(event, id, key))) return;
    await sleep("30s");
  }
  await finish(event, id, key);
}
