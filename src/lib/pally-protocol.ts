import { z } from "zod";
export type ToolShape = {
  name: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
};
export function pallyArguments(
  tool: ToolShape,
  value: string,
  kind: "message" | "check",
) {
  const props = tool.inputSchema.properties || {};
  const candidates =
    kind === "message"
      ? ["message", "prompt", "text"]
      : ["handle", "job_id", "task_id", "request_id", "id"];
  const key = candidates.find((k) => k in props);
  if (!key || (tool.inputSchema.required || []).some((k) => k !== key))
    throw new Error(
      "Pally’s tool format needs an adapter update. No message was sent.",
    );
  return { [key]: value };
}
export function pallyOutput(value: unknown): {
  pending?: string;
  message?: string | null;
  replyTo?: string;
} {
  const objects: Record<string, unknown>[] = [];
  const strings: string[] = [];
  function walk(v: unknown, depth = 0) {
    if (depth > 5) return;
    if (typeof v === "string") {
      strings.push(v);
      try {
        walk(JSON.parse(v), depth + 1);
      } catch {}
      return;
    }
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        v.forEach((x) => walk(x, depth + 1));
        return;
      }
      const o = v as Record<string, unknown>;
      objects.push(o);
      for (const k of [
        "structuredContent",
        "content",
        "text",
        "reply",
        "message",
        "result",
        "output",
        "response",
      ])
        if (k in o) walk(o[k], depth + 1);
    }
  }
  walk(value);
  for (const s of strings) {
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        walk(JSON.parse(fenced[1]));
      } catch {}
    }
  }
  for (const o of objects)
    if ("meetupMessage" in o) {
      const d = z
        .object({
          meetupMessage: z.string().trim().min(1).max(500).nullable(),
          replyTo: z.string().optional(),
        })
        .parse(o);
      return { message: d.meetupMessage, replyTo: d.replyTo };
    }
  for (const o of objects) {
    if (
      ["pending", "running", "queued", "processing", "in_progress"].includes(
        String(o.status),
      ) ||
      "handle" in o
    ) {
      const key = ["handle", "job_id", "task_id", "request_id"].find(
        (k) => typeof o[k] === "string",
      );
      if (key) return { pending: String(o[key]) };
    }
  }
  throw new Error(
    "Pally replied, but did not return a room message in the expected format. Nothing was published.",
  );
}
