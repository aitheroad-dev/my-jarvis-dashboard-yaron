import type { PagesFunction } from "@cloudflare/workers-types";
import { json, requireUser, type Env } from "../../_lib/auth";

/**
 * GET /api/me — the verified identity bootstrap for the SPA.
 *
 * Returns `{ email, role }` derived from the verified CF Access JWT (never the
 * spoofable header). The front end uses `role` to decide what to render: a
 * "move" user (Noa) gets only the move tracker; an "admin" user (owner) gets the
 * full dashboard. Allow-listed by `requireUser`, and reachable by move users
 * (whitelisted in `_middleware.ts`).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env);
    return json({ email: user.email, role: user.role });
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
};
