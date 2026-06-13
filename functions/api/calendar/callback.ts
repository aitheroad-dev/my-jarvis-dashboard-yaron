import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { requireUser, type Env as AuthEnv } from "../../_lib/auth";
import {
  APP_ORIGIN,
  SCOPES,
  encryptToken,
  exchangeCode,
  fetchUserEmail,
  googleConfigured,
  type GoogleEnv,
} from "../../_lib/google";

interface Env extends AuthEnv, GoogleEnv {}

const back = (q: string) => Response.redirect(`${APP_ORIGIN}/meetings?calendar=${q}`, 302);

/** GET /api/calendar/callback — Google redirects here with ?code=. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  if (!googleConfigured(env)) return back("error");

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error");

  const tok = await exchangeCode(env, code);
  if (!tok.ok) return back("error");

  const email = await fetchUserEmail(tok.accessToken);
  const sql = getDb(env);

  if (tok.refreshToken) {
    const enc = await encryptToken(env, tok.refreshToken);
    await sql/* sql */ `
      INSERT INTO calendar_connection (id, google_email, refresh_token_enc, scopes, connected_at, updated_at)
      VALUES (1, ${email}, ${enc}, ${SCOPES.join(" ")},
              strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT (id) DO UPDATE SET
        google_email = excluded.google_email,
        refresh_token_enc = excluded.refresh_token_enc,
        scopes = excluded.scopes,
        updated_at = excluded.updated_at
    `;
  } else {
    // Google withholds a refresh_token when one was already granted and not
    // revoked. We forced prompt=consent to avoid this, but if it still happens
    // and we have no stored token, surface a reconnect rather than a broken
    // connection. If a token already exists, just refresh the email.
    const existing = (await sql/* sql */ `
      SELECT refresh_token_enc FROM calendar_connection WHERE id = 1
    `) as { refresh_token_enc: string | null }[];
    if (!existing[0]?.refresh_token_enc) return back("noToken");
    await sql/* sql */ `
      UPDATE calendar_connection
         SET google_email = ${email}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = 1
    `;
  }
  return back("connected");
};
