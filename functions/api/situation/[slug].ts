import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// GET /api/situation/:slug — one project's full story: card, timeline of
// harvested events (newest first), and the plain next-steps list.

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const slug = String(params.slug ?? "");
  if (!slug) return new Response("missing slug", { status: 400 });

  const sql = getDb(env);
  // Exact slug first; fall back to containment so dashboard project slugs that
  // drifted from PROJECTS.md dir names still resolve (mji-max-security ↔
  // max-security). Tables are tiny; LIKE is fine.
  let rows = (await sql/* sql */ `
    SELECT slug, name, goal, now_text, health, last_activity
    FROM situation_projects WHERE slug = ${slug} LIMIT 1
  `) as Record<string, unknown>[];
  if (rows.length === 0) {
    rows = (await sql/* sql */ `
      SELECT slug, name, goal, now_text, health, last_activity
      FROM situation_projects
      WHERE instr(${slug}, slug) > 0 OR instr(slug, ${slug}) > 0
      ORDER BY length(slug) DESC LIMIT 1
    `) as Record<string, unknown>[];
  }
  if (rows.length === 0) return new Response("not found", { status: 404 });
  const resolved = String(rows[0].slug);

  const events = (await sql/* sql */ `
    SELECT id, ts, kind, title, detail, source
    FROM situation_events WHERE project_slug = ${resolved}
    ORDER BY ts DESC LIMIT 200
  `) as Record<string, unknown>[];

  const next = (await sql/* sql */ `
    SELECT position, text FROM situation_next
    WHERE project_slug = ${resolved} ORDER BY position LIMIT 10
  `) as { position: number; text: string }[];

  const meta = (await sql/* sql */ `
    SELECT value FROM situation_meta WHERE key = 'last_harvest' LIMIT 1
  `) as { value: string }[];

  return json({
    ...rows[0],
    last_harvest: meta[0]?.value ?? null,
    next_steps: next.map((n) => n.text),
    events,
  });
};
