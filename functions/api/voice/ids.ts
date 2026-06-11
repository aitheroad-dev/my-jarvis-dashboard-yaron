import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  VOICE_INGEST_SECRET: string;
}

/**
 * GET /api/voice/ids?since=ISO&limit=N — reconciliation read for the pai-voice
 * courier. Returns ONLY ids + created_at (no content) so the local outbox can
 * diff its ledger against what actually landed here and re-queue anything
 * missing. Authed by the same shared secret as ingest: this is the machine
 * channel, not a user session.
 *
 * created_at is stored verbatim from the client on ingest, so the since-window
 * filter compares the client's own timestamps — no clock-skew surface.
 */
const MAX_LIMIT = 10_000;
const DEFAULT_WINDOW_MS = 3 * 86_400_000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const provided = request.headers.get("X-Voice-Ingest-Secret");
  if (!env.VOICE_INGEST_SECRET) {
    return json(
      { error: "server_misconfigured", reason: "VOICE_INGEST_SECRET not set" },
      { status: 500 },
    );
  }
  if (provided !== env.VOICE_INGEST_SECRET) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since") ?? "";
  const since = /^\d{4}-\d{2}-\d{2}/.test(sinceRaw)
    ? sinceRaw
    : new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
  const limitParsed = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? MAX_LIMIT
      : Math.min(limitParsed, MAX_LIMIT);

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    SELECT id, created_at
    FROM voice_samples
    WHERE created_at >= ${since}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as { id: string; created_at: string }[];

  return json(rows);
};
