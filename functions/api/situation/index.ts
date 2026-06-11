import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// GET /api/situation — the Work Journal payload: the last 14 days of harvested
// events across EVERY stream (projects and standalone work alike), labeled and
// linked to /projects/:slug when a stream corresponds to a dashboard project,
// plus the per-project situation summaries used by the Projects pages.
// Read-only; scripts/harvest-situation.ts is the writer.

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function contains(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return a === b;
  return a.includes(b) || b.includes(a);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const sql = getDb(env);

  const events = (await sql/* sql */ `
    SELECT id, project_slug, ts, kind, title, detail, source
    FROM situation_events
    WHERE ts >= datetime('now', '-14 days')
    ORDER BY ts DESC
    LIMIT 600
  `) as { id: string; project_slug: string; ts: string; kind: string; title: string; detail: string | null; source: string }[];

  const cards = (await sql/* sql */ `
    SELECT
      p.slug, p.name, p.goal, p.now_text, p.health, p.last_activity,
      (SELECT COUNT(*) FROM situation_events e WHERE e.project_slug = p.slug) AS event_count
    FROM situation_projects p
    ORDER BY p.last_activity IS NULL, p.last_activity DESC
    LIMIT 100
  `) as { slug: string; name: string; goal: string | null; now_text: string | null; health: string; last_activity: string | null; event_count: number }[];

  const next = (await sql/* sql */ `
    SELECT project_slug, position, text FROM situation_next
    ORDER BY project_slug, position LIMIT 500
  `) as { project_slug: string; position: number; text: string }[];

  const dashProjects = (await sql/* sql */ `
    SELECT slug, name FROM projects LIMIT 200
  `) as { slug: string; name: string }[];

  const meta = (await sql/* sql */ `
    SELECT key, value FROM situation_meta LIMIT 10
  `) as { key: string; value: string }[];

  // Stream slug → display label (situation card name beats raw slug) and
  // → dashboard project slug (exact, then containment — e.g. max-security
  // ↔ mji-max-security) for linking journal lines to /projects/:slug.
  const labelBySlug = new Map(cards.map((c) => [c.slug, c.name]));
  const linkBySlug = new Map<string, string>();
  for (const stream of new Set(events.map((e) => e.project_slug))) {
    const exact = dashProjects.find((p) => p.slug === stream);
    const fuzzy = exact ?? dashProjects.find((p) => contains(norm(p.slug), stream) || contains(norm(p.name), stream));
    if (fuzzy) linkBySlug.set(stream, fuzzy.slug);
  }

  const nextBySlug = new Map<string, string[]>();
  for (const n of next) {
    const list = nextBySlug.get(n.project_slug) ?? [];
    list.push(n.text);
    nextBySlug.set(n.project_slug, list);
  }

  return json({
    last_harvest: meta.find((m) => m.key === "last_harvest")?.value ?? null,
    events: events.map((e) => ({
      ...e,
      label: labelBySlug.get(e.project_slug) ?? e.project_slug,
      link_slug: linkBySlug.get(e.project_slug) ?? null,
    })),
    projects: cards.map((c) => ({
      ...c,
      next_steps: nextBySlug.get(c.slug) ?? [],
      link_slug: linkBySlug.get(c.slug) ?? null,
    })),
  });
};
