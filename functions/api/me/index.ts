import type { PagesFunction } from "@cloudflare/workers-types";
import { isOwnerEmail, json, requireUser, type Env } from "../../_lib/auth";
import { ALL_PAGE_KEYS, resolveGrant } from "../../_lib/pages";

/**
 * GET /api/me — the verified identity bootstrap for the SPA.
 *
 * Returns `{ email, role, isOwner, pages }` derived from the verified CF Access
 * JWT (never the spoofable header). The front end uses `isOwner` + `pages` to
 * decide what to render: the owner gets the full dashboard; a granted guest gets
 * only their granted pages. `role` is retained for back-compat. Allow-listed by
 * `requireUser`, and reachable by guests (`/api/me` is always-allowed in
 * `_middleware.ts`).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env);
    const owner = isOwnerEmail(user.email, env);
    const grant = await resolveGrant(user.email, env, owner, env.DB);
    const pages = grant === "all" ? ALL_PAGE_KEYS : grant;
    return json({ email: user.email, role: user.role, isOwner: owner, pages });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
};
