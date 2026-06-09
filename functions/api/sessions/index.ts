import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type SessionRow = {
  id: string;
  client_id: string;
  client_name: string | null;
  scheduled_at: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      s.id,
      s.client_id,
      c.name AS client_name,
      s.scheduled_at,
      s.summary,
      s.created_at,
      s.updated_at
    FROM sessions s
    LEFT JOIN clients c ON c.id = s.client_id
    ORDER BY s.scheduled_at DESC
    LIMIT 500
  `) as SessionRow[];

  return json(rows);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let body: {
    client_id?: unknown;
    scheduled_at?: unknown;
    summary?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const scheduledAt =
    typeof body.scheduled_at === "string" ? body.scheduled_at : "";
  if (!clientId) return json({ error: "client_id is required" }, { status: 400 });
  if (!scheduledAt)
    return json({ error: "scheduled_at is required" }, { status: 400 });

  const summary = typeof body.summary === "string" ? body.summary : null;

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    WITH inserted AS (
      INSERT INTO sessions (client_id, scheduled_at, summary)
      VALUES (${clientId}::uuid, ${scheduledAt}::timestamptz, ${summary})
      RETURNING id, client_id, scheduled_at, summary, created_at, updated_at
    )
    SELECT
      i.id,
      i.client_id,
      c.name AS client_name,
      i.scheduled_at,
      i.summary,
      i.created_at,
      i.updated_at
    FROM inserted i
    LEFT JOIN clients c ON c.id = i.client_id
  `) as SessionRow[];

  return json(rows[0], { status: 201 });
};
