import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  // Base URL of the shared meetings Worker (no trailing slash).
  // e.g. https://my-jarvis-meetings.<account>.workers.dev
  MEETINGS_WORKER_URL: string;
  // Per-tenant bearer this dashboard uses to call the meetings Worker.
  // The Worker validates this against the DO config registered for this tenant.
  MEETINGS_TENANT_KEY: string;
  // Tenant slug — the Worker keys its DO by this. Same value the Worker stored at registration.
  MEETINGS_TENANT_SLUG: string;
}

type MeetingRow = {
  id: number;
  title: string;
  meeting_url: string;
  bot_id: string | null;
  status: string;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

/**
 * GET /api/meetings — list meetings, newest first.
 * The org_id check in requireUser() is the access boundary; per-tenant DB
 * already isolates the rows.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const url = new URL(request.url);
  const limitRaw: string | null = url.searchParams.get("limit");
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? 500
      : Math.min(limitParsed, 1000);

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT id, title, meeting_url, bot_id, status, summary,
             started_at, ended_at, created_at
        FROM meetings
       ORDER BY created_at DESC
       LIMIT ${limit}
    `) as MeetingRow[];
    return json({ meetings: rows });
  } catch (err) {
    return json(
      { error: "list failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings — create a meeting and start the Recall bot.
 * Body: { title, meeting_url }.
 * Steps: INSERT row → call Worker /meeting/bot → UPDATE row with bot_id.
 * If the Worker call fails the row is kept in 'failed' status so the caller
 * can retry; we don't roll back the DB write because partial state is more
 * recoverable than missing state.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let body: { title?: unknown; meeting_url?: unknown; language?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const meetingUrl =
    typeof body.meeting_url === "string" ? body.meeting_url.trim() : "";
  const language =
    typeof body.language === "string" && body.language.trim().length > 0
      ? body.language.trim()
      : "he";
  if (!title) return json({ error: "title is required" }, { status: 400 });
  if (!meetingUrl) {
    return json({ error: "meeting_url is required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(meetingUrl)) {
    return json({ error: "meeting_url must be http(s)" }, { status: 400 });
  }

  if (!env.MEETINGS_WORKER_URL || !env.MEETINGS_TENANT_KEY || !env.MEETINGS_TENANT_SLUG) {
    return json(
      { error: "server misconfigured: meetings worker bindings missing" },
      { status: 500 },
    );
  }

  const sql = getDb(env);
  let inserted: MeetingRow;
  try {
    const rows = (await sql/* sql */ `
      INSERT INTO meetings (title, meeting_url, status, started_at)
      VALUES (${title}, ${meetingUrl}, 'starting', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      RETURNING id, title, meeting_url, bot_id, status, summary,
                started_at, ended_at, created_at
    `) as MeetingRow[];
    if (!rows[0]) throw new Error("insert returned no row");
    inserted = rows[0];
  } catch (err) {
    return json(
      { error: "db insert failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  let botId: string | null = null;
  try {
    const workerRes = await fetch(`${env.MEETINGS_WORKER_URL}/meeting/bot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MEETINGS_TENANT_KEY}`,
        "X-Tenant": env.MEETINGS_TENANT_SLUG,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        title,
        meeting_id: inserted.id,
        language,
      }),
    });
    if (!workerRes.ok) {
      const detail = await workerRes.text().catch(() => "");
      await sql/* sql */ `
        UPDATE meetings SET status = 'failed' WHERE id = ${inserted.id}
      `;
      return json(
        {
          error: "worker bot create failed",
          status: workerRes.status,
          detail,
          meeting_id: inserted.id,
        },
        { status: 502 },
      );
    }
    const out = (await workerRes.json()) as { bot_id?: string };
    botId = typeof out.bot_id === "string" ? out.bot_id : null;
  } catch (err) {
    await sql/* sql */ `
      UPDATE meetings SET status = 'failed' WHERE id = ${inserted.id}
    `;
    return json(
      {
        error: "worker bot create errored",
        detail: err instanceof Error ? err.message : String(err),
        meeting_id: inserted.id,
      },
      { status: 502 },
    );
  }

  if (!botId) {
    await sql/* sql */ `
      UPDATE meetings SET status = 'failed' WHERE id = ${inserted.id}
    `;
    return json(
      { error: "worker did not return bot_id", meeting_id: inserted.id },
      { status: 502 },
    );
  }

  const updated = (await sql/* sql */ `
    UPDATE meetings
       SET bot_id = ${botId}, status = 'live'
     WHERE id = ${inserted.id}
   RETURNING id, title, meeting_url, bot_id, status, summary,
             started_at, ended_at, created_at
  `) as MeetingRow[];

  return json({ meeting: updated[0] ?? { ...inserted, bot_id: botId, status: "live" } });
};
