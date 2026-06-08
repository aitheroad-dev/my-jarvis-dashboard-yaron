import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  mission: string | null;
  status: "active" | "paused" | "done" | "archived";
  ticket_count: number;
  goal_count: number;
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
      p.id,
      p.slug,
      p.name,
      p.mission,
      p.status,
      (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id)::int AS ticket_count,
      (SELECT COUNT(*) FROM goals   g WHERE g.project_id = p.id)::int AS goal_count,
      p.created_at,
      p.updated_at
    FROM projects p
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `) as ProjectRow[];

  return json(rows);
};
