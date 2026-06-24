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

type PatchDeployedSiteBody = {
  project?: unknown;
  name?: unknown;
  url?: unknown;
  note?: unknown;
};

function hasOwn(body: PatchDeployedSiteBody, key: keyof PatchDeployedSiteBody): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function validateRequiredPatch(
  body: PatchDeployedSiteBody,
  key: "project" | "name" | "url",
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!hasOwn(body, key)) return { ok: true, value: null };
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${key} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

function validateNotePatch(
  body: PatchDeployedSiteBody,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!hasOwn(body, "note")) return { ok: true, value: null };
  if (body.note === null) return { ok: true, value: null };
  if (typeof body.note !== "string") return { ok: false, error: "note must be text" };
  const trimmed = body.note.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

export const onRequestPatch: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const id = String(params.id ?? "");
  if (!id) return json({ error: "missing id" }, { status: 400 });

  let body: PatchDeployedSiteBody;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    body = raw as PatchDeployedSiteBody;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const project = validateRequiredPatch(body, "project");
  if (!project.ok) return json({ error: project.error }, { status: 400 });

  const name = validateRequiredPatch(body, "name");
  if (!name.ok) return json({ error: name.error }, { status: 400 });

  const url = validateRequiredPatch(body, "url");
  if (!url.ok) return json({ error: url.error }, { status: 400 });

  const note = validateNotePatch(body);
  if (!note.ok) return json({ error: note.error }, { status: 400 });

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      UPDATE deployed_sites
         SET project = CASE WHEN ${hasOwn(body, "project")} THEN ${project.value} ELSE project END,
             name = CASE WHEN ${hasOwn(body, "name")} THEN ${name.value} ELSE name END,
             url = CASE WHEN ${hasOwn(body, "url")} THEN ${url.value} ELSE url END,
             note = CASE WHEN ${hasOwn(body, "note")} THEN ${note.value} ELSE note END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ${id}
       RETURNING id, project, name, url, note, sort_order, created_at, updated_at
    `) as DeployedSiteRow[];

    if (rows.length === 0) return json({ error: "not found" }, { status: 404 });
    return json(rows[0]);
  } catch (err) {
    return json(
      { error: "deployed site update failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

export const onRequestDelete: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const id = String(params.id ?? "");
  if (!id) return json({ error: "missing id" }, { status: 400 });

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      DELETE FROM deployed_sites
       WHERE id = ${id}
       RETURNING id
    `) as { id: string }[];

    if (rows.length === 0) return json({ error: "not found" }, { status: 404 });
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: "deployed site delete failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
