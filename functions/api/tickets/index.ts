import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type TicketRow = {
  id: string;
  slug: string;
  project_id: string | null;
  project_name: string | null;
  goal_id: string | null;
  goal_title: string | null;
  agent: string | null;
  title: string;
  status: "todo" | "in_progress" | "review" | "done" | "archived";
  current_step: string | null;
  progress: string | null;
  source: "pai" | "manual" | null;
  created_at: string;
  updated_at: string;
};

const ALLOWED_STATUS = new Set([
  "todo",
  "in_progress",
  "review",
  "done",
  "archived",
]);
const ALLOWED_TIER = new Set(["E1", "E2", "E3", "E4", "E5"]);
// The four PAI personas (jarvis/atlas/nova/rex). Client-specific agents
// (ben/emma/iris) were removed — they never own dashboard tickets here.
const ALLOWED_AGENT = new Set([
  "jarvis",
  "atlas",
  "nova",
  "rex",
]);

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
      t.id,
      t.slug,
      t.project_id,
      p.name  AS project_name,
      t.goal_id,
      g.title AS goal_title,
      t.agent,
      t.title,
      t.status,
      t.current_step,
      t.progress,
      t.source,
      t.created_at,
      t.updated_at,
      t.log
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN goals    g ON g.id = t.goal_id
    ORDER BY
      CASE t.status
        WHEN 'in_progress' THEN 1
        WHEN 'review'      THEN 2
        WHEN 'todo'        THEN 3
        WHEN 'done'        THEN 4
        WHEN 'archived'    THEN 5
      END,
      t.updated_at DESC
    LIMIT ${limit}
  `) as (TicketRow & { log: string | null })[];

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
    slug?: unknown;
    title?: unknown;
    agent?: unknown;
    status?: unknown;
    tier?: unknown;
    current_step?: unknown;
    project_id?: unknown;
    goal_id?: unknown;
    problem?: unknown;
    goal?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug =
    typeof body.slug === "string" && body.slug.trim()
      ? body.slug.trim()
      : "";
  if (!slug) return json({ error: "slug is required" }, { status: 400 });
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    return json(
      { error: "slug must match [A-Za-z0-9_-]+" },
      { status: 400 },
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "";
  if (!title) return json({ error: "title is required" }, { status: 400 });

  const agentRaw = typeof body.agent === "string" ? body.agent.trim() : "";
  const agent = agentRaw && ALLOWED_AGENT.has(agentRaw) ? agentRaw : null;

  const statusRaw =
    typeof body.status === "string" ? body.status.trim() : "todo";
  const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "todo";

  const tierRaw = typeof body.tier === "string" ? body.tier.trim() : "";
  const tier = tierRaw && ALLOWED_TIER.has(tierRaw) ? tierRaw : null;

  const currentStep =
    typeof body.current_step === "string" && body.current_step.trim()
      ? body.current_step.trim()
      : null;

  const projectId =
    typeof body.project_id === "string" && body.project_id.trim()
      ? body.project_id.trim()
      : null;
  const goalId =
    typeof body.goal_id === "string" && body.goal_id.trim()
      ? body.goal_id.trim()
      : null;

  const problem =
    typeof body.problem === "string" && body.problem.trim()
      ? body.problem.trim()
      : null;
  const goalText =
    typeof body.goal === "string" && body.goal.trim()
      ? body.goal.trim()
      : null;

  const sql = getDb(env);
  try {
    // Cast text → uuid for project_id / goal_id (NULL passes through cleanly).
    const rows = (await sql/* sql */ `
      INSERT INTO tickets (
        slug, title, agent, status, tier, current_step,
        project_id, goal_id, problem, goal
      )
      VALUES (
        ${slug}, ${title}, ${agent}, ${status}, ${tier}, ${currentStep},
        ${projectId}::uuid, ${goalId}::uuid,
        ${problem}, ${goalText}
      )
      RETURNING
        id, slug, project_id, goal_id, agent, title, status, current_step,
        tier, created_at, updated_at
    `) as TicketRow[];
    return json(rows[0], { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      return json(
        { error: `ticket with slug '${slug}' already exists` },
        { status: 409 },
      );
    }
    return json({ error: `insert failed: ${msg}` }, { status: 500 });
  }
};
