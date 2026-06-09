import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type AgentRow = {
  name: string;
  display_name: string;
  voice_kokoro: string;
  voice_mcp: string | null;
  color: string | null;
  identity_md: string | null;
  principles_md: string | null;
  current_ticket_id: string | null;
  current_ticket_title: string | null;
  current_ticket_status: string | null;
  in_flight_count: number;
  updated_at: string;
};

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

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      a.name,
      a.display_name,
      a.voice_kokoro,
      a.voice_mcp,
      a.color,
      a.identity_md,
      a.principles_md,
      a.current_ticket_id,
      ct.title  AS current_ticket_title,
      ct.status AS current_ticket_status,
      (
        SELECT COUNT(*)
        FROM tickets t
        WHERE t.agent = a.name
          AND t.status IN ('todo','in_progress','review')
      ) AS in_flight_count,
      a.updated_at
    FROM agents a
    LEFT JOIN tickets ct ON ct.id = a.current_ticket_id
    ORDER BY a.display_name
    LIMIT ${limit}
  `) as AgentRow[];

  return json(rows);
};
