import { createHash } from "node:crypto";
import { AppError } from "./domain";
export const challenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
export function validRedirect(value: string) {
  const u = new URL(value);
  if (
    u.hash ||
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    )
  )
    throw new AppError(400, "Use an HTTPS redirect URL or localhost.");
  return value;
}
export function roomFromResource(value: string, origin: string) {
  const u = new URL(value);
  const match = u.pathname.match(/^\/api\/e\/([a-z0-9-]{1,64})\/mcp$/);
  if (u.origin !== origin || !match || u.search || u.hash)
    throw new AppError(400, "Choose a valid meetup MCP endpoint.");
  return match[1];
}
export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/connect/authorize`,
    token_endpoint: `${origin}/api/connect/token`,
    registration_endpoint: `${origin}/api/connect/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["room"],
    resource_indicators_supported: true,
  };
}
export type Authorization = {
  client: string;
  redirect: string;
  resource: string;
  event: string;
  challenge: string;
  state: string;
  browserHash: string;
  name: string;
};
