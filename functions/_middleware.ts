import type { PagesFunction } from "@cloudflare/workers-types";
import { identifyAccessUser, type Env } from "./_lib/auth";

/**
 * Server-side authorization wall (RBAC).
 *
 * The dashboard is single-tenant, but the "move" role (Noa) is scoped to a small
 * set of SHARED pages — the move tracker and the rental search (/api/move +
 * /api/rental). CF Access lets her email in at the edge and every handler's
 * `requireUser` would otherwise grant her full read access. This middleware is
 * the single choke point that enforces the scope: a positively-verified
 * move-role browser user may reach ONLY the paths in `moveAllowed`; everything
 * else under `/api/*` returns 403.
 *
 * It is deliberately ADDITIVE — it never replaces a handler's own auth:
 *   - Non-API requests pass straight through (static assets + SPA client routes).
 *   - Machine callers (voice courier, MCP) carry no CF Access user JWT (they use
 *     their own secret), so `identifyAccessUser` returns null and they fall
 *     through to the handler, which checks its own secret.
 *   - Admin (owner) users pass through; their handlers still `requireUser`.
 * So this can only ADD a restriction for a known move user — it can never weaken
 * existing auth or break the machine channel.
 *
 * Encoding-robust (hardened after Forge audit, 2026-06-22): the move decision is
 * made on BOTH the raw and the fully-decoded path, with traversal sequences
 * rejected — so an encoded prefix (`/%61pi/...`) or encoded dot-segment
 * (`/api/move/%2e%2e%2f...`) cannot slip past, regardless of how Cloudflare
 * routes encoded octets.
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

/**
 * Whether a (decoded, canonical) path is reachable by a move user. Exact
 * allow-list, with any traversal/odd-separator path rejected outright.
 */
export function moveAllowed(pathname: string): boolean {
  if (
    pathname.includes("..") ||
    pathname.includes("//") ||
    pathname.includes("\\")
  ) {
    return false;
  }
  if (
    pathname === "/api/me" ||
    pathname === "/api/version" ||
    pathname === "/api/move" ||
    pathname === "/api/rental"
  ) {
    return true;
  }
  // /api/move/<id> — a single clean segment (PATCH/DELETE a task).
  return /^\/api\/move\/[^/]+$/.test(pathname);
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
  // Admins and machine callers (identify → null) are unaffected.
  const user = await identifyAccessUser(request, env);
  if (user?.role !== "move") return next();

  // Move user: BOTH the raw and the decoded form must be plainly allowed.
  if (decoded !== null && moveAllowed(raw) && moveAllowed(decoded)) {
    return next();
  }
  return new Response(
    JSON.stringify({ error: "forbidden", reason: "move-only role" }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
};
