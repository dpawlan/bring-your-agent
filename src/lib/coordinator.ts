import { sleep, getWorkflowMetadata } from "workflow";
import { claim, runTurn, release } from "./hosted";
export async function coordinate(slug: string) {
  "use workflow";
  const id = getWorkflowMetadata().workflowRunId;
  if (!(await claim(slug, id))) return;
  for (let turn = 0; turn < 180; turn++) {
    const keepGoing = await runTurn(slug, `${id}:${turn}`);
    if (!keepGoing) {
      await release(slug, id);
      return;
    }
    await sleep("20s");
  }
  await release(slug, id);
}
