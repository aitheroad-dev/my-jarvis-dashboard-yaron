import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type TicketDetail = {
  id: string;
  slug: string;
  project_id: string | null;
  project_name: string | null;
  goal_id: string | null;
  goal_title: string | null;
  parent_id: string | null;
  agent: string | null;
  title: string;
  status: "todo" | "in_progress" | "review" | "done" | "archived";
  tier: "E1" | "E2" | "E3" | "E4" | "E5" | null;
  current_step: string | null;
  isa_path: string | null;
  problem: string | null;
  vision: string | null;
  out_of_scope: string | null;
  principles: string | null;
  constraints: string | null;
  goal: string | null;
  test_strategy: string | null;
  features: string | null;
  decisions: string | null;
  changelog: string | null;
  verification: string | null;
  iscs: { id: string; text: string; done: boolean }[];
  log: string | null;
  created_at: string;
  updated_at: string;
};

type TicketDetailRow = Omit<TicketDetail, "iscs"> & {
  iscs: string | null;
};

type Movement = {
  kind: "commit" | "pivot" | "decision" | "milestone";
  ts: string | null;
  summary: string;
  ref: string | null;
  progress: string | null;
};

const ALLOWED_STATUS = new Set([
  "todo",
  "in_progress",
  "review",
  "done",
  "archived",
]);
const ALLOWED_TIER = new Set(["E1", "E2", "E3", "E4", "E5"]);
const ALLOWED_STEP = new Set([
  "OBSERVE",
  "THINK",
  "PLAN",
  "BUILD",
  "EXECUTE",
  "VERIFY",
  "LEARN",
  "COMPLETE",
]);
// The four PAI personas (jarvis/atlas/nova/rex). Client-specific agents
// (ben/emma/iris) were removed — they never own dashboard tickets here.
const ALLOWED_AGENT = new Set([
  "jarvis",
  "atlas",
  "nova",
  "rex",
]);

// Columns the PUT endpoint is willing to update — keep the surface small and
// explicit so a stray client field can't poison rows.
const UPDATABLE_TEXT_COLUMNS = [
  "title",
  "problem",
  "vision",
  "out_of_scope",
  "principles",
  "constraints",
  "goal",
  "test_strategy",
  "features",
  "decisions",
  "changelog",
  "verification",
  "log",
] as const;

// Type captured for documentation; not currently referenced at runtime.
export type _TicketsTextColumn = (typeof UPDATABLE_TEXT_COLUMNS)[number];

export const onRequestGet: PagesFunction<Env, "slug"> = async ({
  request,
  env,
  params,
}) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const slug = String(params.slug ?? "");
  if (!slug) return json({ error: "slug required" }, { status: 400 });

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      t.id,
      t.slug,
      t.project_id,
      p.name  AS project_name,
      t.goal_id,
      g.title AS goal_title,
      t.parent_id,
      t.agent,
      t.title,
      t.status,
      t.tier,
      t.current_step,
      t.isa_path,
      t.problem,
      t.vision,
      t.out_of_scope,
      t.principles,
      t.constraints,
      t.goal,
      t.test_strategy,
      t.features,
      t.decisions,
      t.changelog,
      t.verification,
      t.iscs,
      t.log,
      t.created_at,
      t.updated_at
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN goals    g ON g.id = t.goal_id
    WHERE t.slug = ${slug}
  `) as TicketDetailRow[];

  if (rows.length === 0) {
    return json({ error: "ticket not found" }, { status: 404 });
  }

  const iscs = rows[0].iscs ? JSON.parse(rows[0].iscs as string) : [];

  // Movement feed — the derived timeline (commits / pivots / decisions /
  // milestones). Dated entries first (chronological), then undated by sequence.
  // ticket_movements is provisioned outside the consolidated D1 schema.
  const movements = (await sql/* sql */ `
    SELECT kind, ts, summary, ref, progress
    FROM ticket_movements
    WHERE ticket_slug = ${slug}
    ORDER BY (ts IS NULL), ts ASC, seq ASC
  `) as Movement[];

  return json({ ...rows[0], iscs, movements });
};

export const onRequestPut: PagesFunction<Env, "slug"> = async ({
  request,
  env,
  params,
}) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const slug = String(params.slug ?? "");
  if (!slug) return json({ error: "slug required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sql = getDb(env);

  // Build a SET clause from whitelisted columns. We do this with explicit
  // tagged-template fragments instead of dynamic strings so the D1 adapter
  // keeps every value parameterized.
  const updates: { col: string; value: string | null }[] = [];

  for (const col of UPDATABLE_TEXT_COLUMNS) {
    if (col in body) {
      const raw = body[col];
      const value =
        raw === null || raw === undefined
          ? null
          : typeof raw === "string"
            ? raw
            : String(raw);
      updates.push({ col, value });
    }
  }

  if ("status" in body) {
    const raw = typeof body.status === "string" ? body.status : "";
    if (!ALLOWED_STATUS.has(raw)) {
      return json({ error: `invalid status '${raw}'` }, { status: 400 });
    }
    updates.push({ col: "status", value: raw });
  }
  if ("tier" in body) {
    const raw = body.tier;
    if (raw === null) {
      updates.push({ col: "tier", value: null });
    } else if (typeof raw === "string" && ALLOWED_TIER.has(raw)) {
      updates.push({ col: "tier", value: raw });
    } else {
      return json({ error: `invalid tier '${String(raw)}'` }, { status: 400 });
    }
  }
  if ("current_step" in body) {
    const raw = body.current_step;
    if (raw === null) {
      updates.push({ col: "current_step", value: null });
    } else if (typeof raw === "string" && ALLOWED_STEP.has(raw)) {
      updates.push({ col: "current_step", value: raw });
    } else {
      return json(
        { error: `invalid current_step '${String(raw)}'` },
        { status: 400 },
      );
    }
  }
  if ("agent" in body) {
    const raw = body.agent;
    if (raw === null || raw === "") {
      updates.push({ col: "agent", value: null });
    } else if (typeof raw === "string" && ALLOWED_AGENT.has(raw)) {
      updates.push({ col: "agent", value: raw });
    } else {
      return json(
        { error: `invalid agent '${String(raw)}'` },
        { status: 400 },
      );
    }
  }

  // iscs handled separately because it's JSON (full array replace) ─────────
  let iscsReplace:
    | { id: string; text: string; done: boolean }[]
    | undefined;
  if ("iscs" in body) {
    if (!Array.isArray(body.iscs)) {
      return json({ error: "iscs must be an array" }, { status: 400 });
    }
    const cleaned: { id: string; text: string; done: boolean }[] = [];
    for (const item of body.iscs) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const text = typeof r.text === "string" ? r.text : "";
      const done = r.done === true;
      if (!id || !text) {
        return json(
          { error: "every isc needs string id + text" },
          { status: 400 },
        );
      }
      cleaned.push({ id, text, done });
    }
    iscsReplace = cleaned;
  }

  if (updates.length === 0 && iscsReplace === undefined) {
    return json({ error: "no updatable fields supplied" }, { status: 400 });
  }

  // Apply each whitelisted update as its own UPDATE — small N, simple, safe.
  // (Concatenating into one parameterized statement requires raw fragments
  //  that the http driver doesn't expose conveniently. This keeps things
  //  readable and parameterized.)
  for (const { col, value } of updates) {
    switch (col) {
      case "title":
        await sql/* sql */ `UPDATE tickets SET title = ${value} WHERE slug = ${slug}`;
        break;
      case "problem":
        await sql/* sql */ `UPDATE tickets SET problem = ${value} WHERE slug = ${slug}`;
        break;
      case "vision":
        await sql/* sql */ `UPDATE tickets SET vision = ${value} WHERE slug = ${slug}`;
        break;
      case "out_of_scope":
        await sql/* sql */ `UPDATE tickets SET out_of_scope = ${value} WHERE slug = ${slug}`;
        break;
      case "principles":
        await sql/* sql */ `UPDATE tickets SET principles = ${value} WHERE slug = ${slug}`;
        break;
      case "constraints":
        await sql/* sql */ `UPDATE tickets SET constraints = ${value} WHERE slug = ${slug}`;
        break;
      case "goal":
        await sql/* sql */ `UPDATE tickets SET goal = ${value} WHERE slug = ${slug}`;
        break;
      case "test_strategy":
        await sql/* sql */ `UPDATE tickets SET test_strategy = ${value} WHERE slug = ${slug}`;
        break;
      case "features":
        await sql/* sql */ `UPDATE tickets SET features = ${value} WHERE slug = ${slug}`;
        break;
      case "decisions":
        await sql/* sql */ `UPDATE tickets SET decisions = ${value} WHERE slug = ${slug}`;
        break;
      case "changelog":
        await sql/* sql */ `UPDATE tickets SET changelog = ${value} WHERE slug = ${slug}`;
        break;
      case "verification":
        await sql/* sql */ `UPDATE tickets SET verification = ${value} WHERE slug = ${slug}`;
        break;
      case "log":
        await sql/* sql */ `UPDATE tickets SET log = ${value} WHERE slug = ${slug}`;
        break;
      case "status":
        await sql/* sql */ `UPDATE tickets SET status = ${value} WHERE slug = ${slug}`;
        break;
      case "tier":
        await sql/* sql */ `UPDATE tickets SET tier = ${value} WHERE slug = ${slug}`;
        break;
      case "current_step":
        await sql/* sql */ `UPDATE tickets SET current_step = ${value} WHERE slug = ${slug}`;
        break;
      case "agent":
        await sql/* sql */ `UPDATE tickets SET agent = ${value} WHERE slug = ${slug}`;
        break;
      default:
        // unknown column — defensively skip
        break;
    }
  }

  if (iscsReplace !== undefined) {
    const iscsJson = JSON.stringify(iscsReplace);
    await sql/* sql */ `
      UPDATE tickets
      SET iscs = ${iscsJson}
      WHERE slug = ${slug}
    `;
  }

  // Return the fresh row.
  const rows = (await sql/* sql */ `
    SELECT
      t.id,
      t.slug,
      t.project_id,
      p.name  AS project_name,
      t.goal_id,
      g.title AS goal_title,
      t.parent_id,
      t.agent,
      t.title,
      t.status,
      t.tier,
      t.current_step,
      t.isa_path,
      t.problem,
      t.vision,
      t.out_of_scope,
      t.principles,
      t.constraints,
      t.goal,
      t.test_strategy,
      t.features,
      t.decisions,
      t.changelog,
      t.verification,
      t.iscs,
      t.log,
      t.created_at,
      t.updated_at
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN goals    g ON g.id = t.goal_id
    WHERE t.slug = ${slug}
  `) as TicketDetailRow[];

  if (rows.length === 0) {
    return json({ error: "ticket not found after update" }, { status: 404 });
  }
  const iscs = rows[0].iscs ? JSON.parse(rows[0].iscs as string) : [];
  return json({ ...rows[0], iscs });
};

/**
 * PATCH /api/tickets/:slug
 * Targeted ISC flip — body: { isc_id: "ISC-2", done: true }.
 * Reads the JSON array, updates the matching id, and writes the array back.
 */
export const onRequestPatch: PagesFunction<Env, "slug"> = async ({
  request,
  env,
  params,
}) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const slug = String(params.slug ?? "");
  if (!slug) return json({ error: "slug required" }, { status: 400 });

  let body: { isc_id?: unknown; done?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }
  const iscId = typeof body.isc_id === "string" ? body.isc_id : "";
  const done = body.done === true;
  if (!iscId) return json({ error: "isc_id required" }, { status: 400 });

  const sql = getDb(env);

  // Fetch current iscs, find by id, mutate, write back. This read-modify-write
  // is fine for our scale (single-digit ISCs per ticket).
  const cur = (await sql/* sql */ `
    SELECT iscs FROM tickets WHERE slug = ${slug}
  `) as { iscs: string | null }[];

  if (cur.length === 0) {
    return json({ error: "ticket not found" }, { status: 404 });
  }

  const parsed = cur[0].iscs ? JSON.parse(cur[0].iscs as string) : [];
  const iscs = Array.isArray(parsed) ? [...parsed] : [];
  const idx = iscs.findIndex((i) => i?.id === iscId);
  if (idx < 0) {
    return json({ error: `isc '${iscId}' not found` }, { status: 404 });
  }
  iscs[idx] = { ...iscs[idx], done };

  const iscsJson = JSON.stringify(iscs);
  await sql/* sql */ `
    UPDATE tickets SET iscs = ${iscsJson} WHERE slug = ${slug}
  `;
  return json({ slug, iscs });
};

/**
 * DELETE /api/tickets/:slug — soft-delete via status='archived'.
 */
export const onRequestDelete: PagesFunction<Env, "slug"> = async ({
  request,
  env,
  params,
}) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const slug = String(params.slug ?? "");
  if (!slug) return json({ error: "slug required" }, { status: 400 });

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    UPDATE tickets SET status = 'archived' WHERE slug = ${slug}
    RETURNING id, slug, status
  `) as { id: string; slug: string; status: string }[];

  if (rows.length === 0) {
    return json({ error: "ticket not found" }, { status: 404 });
  }
  return json(rows[0]);
};
