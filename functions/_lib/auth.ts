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
  /** Comma-separated emails restricted to the move tracker only (role "move"). */
  ACCESS_MOVE_ONLY_EMAILS?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export type Role = "admin" | "move";

export type AuthedUser = {
  userId: string;
  email: string;
  role: Role;
  sessionId: string | null;
  orgId: string;
};

// Known-good defaults (verified live 2026-06-22). Env vars override; the
// defaults exist so a dropped var can never lock the owner out of the dashboard.
const DEFAULT_TEAM_DOMAIN = "small-fire-f8d3.cloudflareaccess.com";
const DEFAULT_AUD =
  "da27b6b7d6ed7f4d92516c708135a929b85e55f8dd75ad5504b799d6e3930946";
const DEFAULT_ALLOWED = "aitheroad@gmail.com,noabarkai@gmail.com";
// Emails restricted to the move tracker only (role "move"). The owner is
// force-excluded in moveOnlySet() so a mis-edit here can never lock the owner
// into a move-only role.
const DEFAULT_MOVE_ONLY = "noabarkai@gmail.com";

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

function ownerEmails(env: Env): Set<string> {
  const set = new Set<string>(["aitheroad@gmail.com"]);
  if (env.TENANT_OWNER_EMAIL) set.add(env.TENANT_OWNER_EMAIL.toLowerCase());
  return set;
}

function moveOnlySet(env: Env): Set<string> {
  const raw = env.ACCESS_MOVE_ONLY_EMAILS ?? DEFAULT_MOVE_ONLY;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  // Owner is NEVER move-restricted — lockout-safety.
  for (const owner of ownerEmails(env)) set.delete(owner);
  return set;
}

/** Maps an allow-listed email to its role. Owner → admin; move-only list → move. */
export function roleFor(email: string, env: Env): Role {
  return moveOnlySet(env).has(email.toLowerCase()) ? "move" : "admin";
}

/**
 * Verifies the CF Access JWT and returns the lowercased `email` claim ("" when
 * the verified token carries no email, e.g. a service token). Throws a 401
 * Response on a missing or invalid token.
 */
async function verifyAccessEmail(request: Request, env: Env): Promise<string> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw unauthorized(
      "missing Cf-Access-Jwt-Assertion (request did not pass Access)",
    );
  }
  const teamDomain = env.ACCESS_TEAM_DOMAIN || DEFAULT_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD || DEFAULT_AUD;
  const issuer = `https://${teamDomain}`;
  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      audience,
      issuer,
      algorithms: ["RS256"],
    });
    return String(payload.email ?? "").toLowerCase();
  } catch (e) {
    const code =
      (e as { code?: string })?.code ??
      (e as Error)?.message ??
      "verify_failed";
    throw unauthorized(`invalid Access token: ${code}`);
  }
}

/**
 * Soft identity for `_middleware.ts`. Returns the role-bearing identity ONLY for
 * a positively-verified, allow-listed browser user. Returns null for machine
 * callers (no Access JWT — they auth with their own secret), service tokens
 * (verified but no email claim), invalid tokens, and non-allow-listed emails —
 * all of which must fall through to the handler's own auth. Never throws.
 */
export async function identifyAccessUser(
  request: Request,
  env: Env,
): Promise<{ email: string; role: Role } | null> {
  if (!request.headers.get("Cf-Access-Jwt-Assertion")) return null;
  let email: string;
  try {
    email = await verifyAccessEmail(request, env);
  } catch {
    return null;
  }
  if (!email || !allowList(env).has(email)) return null;
  return { email, role: roleFor(email, env) };
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
 * closed with 401. The returned `role` scopes authorization (see _middleware.ts).
 */
export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthedUser> {
  const email = await verifyAccessEmail(request, env);
  if (!email) {
    throw unauthorized("verified token carries no email claim");
  }
  if (!allowList(env).has(email)) {
    throw unauthorized(`email ${email} not authorized for this dashboard`);
  }

  return {
    userId: email,
    email,
    role: roleFor(email, env),
    sessionId: request.headers.get("Cf-Access-Jwt-Assertion"),
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
