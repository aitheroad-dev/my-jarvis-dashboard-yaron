import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  /** Cloudflare D1 (SQLite) — the dashboard's data store. Replaces Neon. */
  DB: D1Database;
  /** Cloudflare R2 bucket holding voice-clip audio (replaces Postgres bytea). */
  VOICE_BUCKET: R2Bucket;
  /** Public base URL for the R2 voice bucket, e.g. https://pub-xxxx.r2.dev */
  VOICE_PUBLIC_URL: string;
  TENANT_OWNER_EMAIL: string;
  /** CF Access team auth domain, e.g. small-fire-f8d3.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** CF Access Application Audience (AUD) tag for this app. */
  ACCESS_AUD?: string;
  /** Comma-separated allow-list of authorized emails. */
  ACCESS_ALLOWED_EMAILS?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export type AuthedUser = {
  userId: string;
  sessionId: string | null;
  orgId: string;
};

// Known-good defaults (verified live 2026-06-22). Env vars override; the
// defaults exist so a dropped var can never lock the owner out of the dashboard.
const DEFAULT_TEAM_DOMAIN = "small-fire-f8d3.cloudflareaccess.com";
const DEFAULT_AUD =
  "da27b6b7d6ed7f4d92516c708135a929b85e55f8dd75ad5504b799d6e3930946";
const DEFAULT_ALLOWED = "aitheroad@gmail.com,noabarkai@gmail.com";

// Module-scope JWKS cache, keyed by team domain. jose handles key rotation +
// cooldown internally; reusing the set across requests in an isolate avoids a
// certs fetch per request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(teamDomain: string) {
  let set = jwksCache.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    jwksCache.set(teamDomain, set);
  }
  return set;
}

function allowList(env: Env): Set<string> {
  const raw = env.ACCESS_ALLOWED_EMAILS || DEFAULT_ALLOWED;
  const emails = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Always include the configured owner so the owner cannot be locked out.
  if (env.TENANT_OWNER_EMAIL) emails.push(env.TENANT_OWNER_EMAIL.toLowerCase());
  return new Set(emails);
}

/**
 * Verifies the Cloudflare Access JWT and authorizes the caller.
 *
 * Cloudflare Access injects `Cf-Access-Jwt-Assertion` (a signed RS256 JWT) on
 * every request that passes the Access policy. We VERIFY that token's
 * signature against the team JWKS, check issuer + audience, and derive the
 * email from the verified claims — never from the spoofable
 * `Cf-Access-Authenticated-User-Email` header. Then the email must be on the
 * allow-list. Direct-to-origin requests (which carry no valid assertion) fail
 * closed with 401.
 */
export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthedUser> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw unauthorized(
      "missing Cf-Access-Jwt-Assertion (request did not pass Access)",
    );
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN || DEFAULT_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD || DEFAULT_AUD;
  const issuer = `https://${teamDomain}`;

  let email: string;
  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      audience,
      issuer,
    });
    email = String(payload.email ?? "").toLowerCase();
  } catch (e) {
    const code =
      (e as { code?: string })?.code ??
      (e as Error)?.message ??
      "verify_failed";
    throw unauthorized(`invalid Access token: ${code}`);
  }

  if (!email) {
    throw unauthorized("verified token carries no email claim");
  }
  if (!allowList(env).has(email)) {
    throw unauthorized(`email ${email} not authorized for this dashboard`);
  }

  return {
    userId: email,
    sessionId: token,
    orgId: "single-tenant",
  };
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
