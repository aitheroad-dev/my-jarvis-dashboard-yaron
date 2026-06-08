import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type GoalRow = {
  id: string;
  slug: string;
  project_id: string;
  project_name: string | null;
  title: string;
  description: string | null;
  status: "active" | "paused" | "done" | "archived";
  ticket_count: number;
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
      g.id,
      g.slug,
      g.project_id,
      p.name AS project_name,
      g.title,
      g.description,
      g.status,
      (SELECT COUNT(*) FROM tickets t WHERE t.goal_id = g.id)::int AS ticket_count,
      g.created_at,
      g.updated_at
    FROM goals g
    LEFT JOIN projects p ON p.id = g.project_id
    ORDER BY g.created_at DESC
    LIMIT ${limit}
  `) as GoalRow[];

  return json(rows);
};
