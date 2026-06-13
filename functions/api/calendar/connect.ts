import type { PagesFunction } from "@cloudflare/workers-types";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";
import { buildConsentUrl, googleConfigured, type GoogleEnv } from "../../_lib/google";

interface Env extends AuthEnv, GoogleEnv {}

/** GET /api/calendar/connect — redirect the owner to Google's consent screen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  if (!googleConfigured(env)) {
    return json(
      { error: "not configured", detail: "Google OAuth client / token key not set on this deployment." },
      { status: 500 },
    );
  }
  const state = crypto.randomUUID();
  return Response.redirect(buildConsentUrl(env, state), 302);
};
