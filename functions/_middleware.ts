import type { PagesFunction } from "@cloudflare/workers-types";
import { identifyAccessUser, isOwnerEmail, type Env } from "./_lib/auth";
import { allowedApiPrefixes, apiPathAllowed, resolveGrant } from "./_lib/pages";

/**
 * Server-side authorization wall (page-grant RBAC).
 *
 * The dashboard is single-tenant (owner = full access), but any other allow-listed
 * user is scoped to an explicit set of SHARED pages via the grant map in
 * `_lib/pages.ts`. CF Access lets an allow-listed email in at the edge; this
 * middleware is the single choke point that enforces the per-page scope: a
 * positively-verified non-owner user may reach ONLY the `/api/*` prefixes their
 * granted pages need (plus self-scoped endpoints); everything else returns 403.
 *
 * Deliberately ADDITIVE — it never replaces a handler's own auth:
 *   - Non-API requests pass straight through (static assets + SPA client routes).
 *   - Machine callers (voice courier, MCP) carry no CF Access user JWT (they use
 *     their own secret), so `identifyAccessUser` returns null and they fall
 *     through to the handler, which checks its own secret.
 *   - Owner users pass through; their handlers still `requireUser`.
 * So this can only ADD a restriction for a known non-owner user — it can never
 * weaken existing auth or break the machine channel.
 *
 * Encoding-robust: the decision is made on BOTH the raw and the fully-decoded
 * path, with traversal sequences rejected (see `apiPathAllowed`) — so an encoded
 * prefix (`/%61pi/...`) or encoded dot-segment (`/api/move/%2e%2e%2f...`) cannot
 * slip past, regardless of how Cloudflare routes encoded octets.
 */

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Fully percent-decode a path (defeats double-encoding). null on malformed input. */
function safeDecode(pathname: string): string | null {
  try {
    let cur = pathname;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(cur);
      if (next === cur) return cur;
      cur = next;
    }
    return cur;
  } catch {
    return null;
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, next } = ctx;
  const raw = new URL(request.url).pathname;
  const decoded = safeDecode(raw);

  // Fast path: a cleanly-decoded, non-API request carries no owner data — skip
  // all auth work. Covers static assets + SPA client routes for every role.
  const apiish = isApiPath(raw) || (decoded !== null && isApiPath(decoded));
  if (decoded !== null && !apiish) return next();

  // API-ish (or malformed-encoding) request: only now pay for identity.
  // Machine callers (identify → null) and the owner are unaffected.
  const user = await identifyAccessUser(request, env);
  if (!user) return next();
  if (isOwnerEmail(user.email, env)) return next();

  // Non-owner: enforce the grant. BOTH raw and decoded forms must be allowed.
  const prefixes = allowedApiPrefixes(await resolveGrant(user.email, env, false, env.DB));
  if (
    decoded !== null &&
    apiPathAllowed(raw, prefixes) &&
    apiPathAllowed(decoded, prefixes)
  ) {
    return next();
  }
  return new Response(
    JSON.stringify({ error: "forbidden", reason: "not granted for this page" }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
};
