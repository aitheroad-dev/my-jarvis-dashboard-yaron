import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type DeployedSiteRow = {
  id: string;
  project: string;
  name: string;
  url: string;
  note: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type CreateDeployedSiteBody = {
  project?: unknown;
  name?: unknown;
  url?: unknown;
  note?: unknown;
};

type MaxSortOrderRow = { max_sort_order: number | null };

function requiredText(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: value.trim() };
}

function optionalText(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "note must be text" };
  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT id, project, name, url, note, sort_order, created_at, updated_at
        FROM deployed_sites
       ORDER BY sort_order ASC, project ASC, name ASC
       LIMIT 1000
    `) as DeployedSiteRow[];

    return json(rows);
  } catch (err) {
    return json(
      { error: "deployed sites fetch failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let body: CreateDeployedSiteBody;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    body = raw as CreateDeployedSiteBody;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const project = requiredText(body.project, "project");
  if (!project.ok) return json({ error: project.error }, { status: 400 });

  const name = requiredText(body.name, "name");
  if (!name.ok) return json({ error: name.error }, { status: 400 });

  const url = requiredText(body.url, "url");
  if (!url.ok) return json({ error: url.error }, { status: 400 });

  const note = optionalText(body.note);
  if (!note.ok) return json({ error: note.error }, { status: 400 });

  try {
    const sql = getDb(env);
    const projectMaxRows = (await sql/* sql */ `
      SELECT MAX(sort_order) AS max_sort_order FROM deployed_sites WHERE project = ${project.value}
    `) as MaxSortOrderRow[];
    // Append within an existing project; a new project starts after the global max.
    let sortOrder = projectMaxRows[0]?.max_sort_order;
    if (sortOrder === null || sortOrder === undefined) {
      const globalMaxRows = (await sql/* sql */ `
        SELECT MAX(sort_order) AS max_sort_order FROM deployed_sites
      `) as MaxSortOrderRow[];
      sortOrder = globalMaxRows[0]?.max_sort_order ?? -1;
    }
    const nextSortOrder = sortOrder + 1;
    const id = crypto.randomUUID();
    const rows = (await sql/* sql */ `
      INSERT INTO deployed_sites (id, project, name, url, note, sort_order)
      VALUES (${id}, ${project.value}, ${name.value}, ${url.value}, ${note.value}, ${nextSortOrder})
      RETURNING id, project, name, url, note, sort_order, created_at, updated_at
    `) as DeployedSiteRow[];

    return json(rows[0], { status: 201 });
  } catch (err) {
    return json(
      { error: "deployed site create failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
