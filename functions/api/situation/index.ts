import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// GET /api/situation — the portfolio: every project's situation card plus
// harvest freshness. Read-only; scripts/harvest-situation.ts is the writer.

type SituationProject = {
  slug: string;
  name: string;
  goal: string | null;
  now_text: string | null;
  health: string;
  last_activity: string | null;
  event_count: number;
  last_event_title: string | null;
  next_steps: string[];
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const sql = getDb(env);
  const projects = (await sql/* sql */ `
    SELECT
      p.slug, p.name, p.goal, p.now_text, p.health, p.last_activity,
      (SELECT COUNT(*) FROM situation_events e WHERE e.project_slug = p.slug) AS event_count,
      (SELECT e.title FROM situation_events e WHERE e.project_slug = p.slug
        ORDER BY e.ts DESC LIMIT 1) AS last_event_title
    FROM situation_projects p
    ORDER BY p.last_activity IS NULL, p.last_activity DESC
    LIMIT 100
  `) as Omit<SituationProject, "next_steps">[];

  const next = (await sql/* sql */ `
    SELECT project_slug, position, text FROM situation_next
    ORDER BY project_slug, position LIMIT 500
  `) as { project_slug: string; position: number; text: string }[];

  const meta = (await sql/* sql */ `
    SELECT key, value FROM situation_meta LIMIT 10
  `) as { key: string; value: string }[];

  const nextBySlug = new Map<string, string[]>();
  for (const n of next) {
    const list = nextBySlug.get(n.project_slug) ?? [];
    list.push(n.text);
    nextBySlug.set(n.project_slug, list);
  }

  return json({
    last_harvest: meta.find((m) => m.key === "last_harvest")?.value ?? null,
    projects: projects.map((p) => ({
      ...p,
      next_steps: nextBySlug.get(p.slug) ?? [],
    })),
  });
};
