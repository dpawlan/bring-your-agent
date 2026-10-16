import { defineAgent } from "eve";
export default defineAgent({
  model: "openai/gpt-4.1-mini",
  defaultTools: false,
  tool: false,
  limits: {
    maxTokenCostUsdPerSession: 1,
    maxOutputTokensPerSession: 15000,
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
  },
  experimental: { workflow: { retention: 0 } },
});
