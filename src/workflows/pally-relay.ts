import { sleep } from "workflow";
async function tick(event: string, id: string, key: string) {
  "use step";
  const { relayTick } = await import("../lib/pally");
  const continuing = await relayTick(event, id, key);
  console.log("Meetup relay tick", { event, continuing });
  return continuing;
}
tick.maxRetries = 0;
export async function pallyRelay(event: string, id: string, key: string) {
  "use workflow";
  while (true) {
    if (!(await tick(event, id, key))) return;
    await sleep("30s");
  }
}
