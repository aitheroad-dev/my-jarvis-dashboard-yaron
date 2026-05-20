import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type ProjectDetail = {
  id: string;
  slug: string;
  name: string;
  mission: string | null;
  body: string | null;
  status: "active" | "paused" | "done" | "archived";
  created_at: string;
  updated_at: string;
  goals: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    status: string;
  }[];
  tickets: {
    id: string;
    slug: string;
    title: string;
    status: string;
    tier: string | null;
    current_step: string | null;
    agent: string | null;
  }[];
};

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
  const rows = (await sql/* sql */ `
    SELECT id, slug, name, mission, body, status, created_at, updated_at
    FROM projects
    WHERE slug = ${slug}
    LIMIT 1
  `) as Omit<ProjectDetail, "goals" | "tickets">[];

  if (rows.length === 0) return new Response("not found", { status: 404 });
  const project = rows[0];

  const goals = (await sql/* sql */ `
    SELECT id, slug, title, description, status
    FROM goals
    WHERE project_id = ${project.id}
    ORDER BY created_at DESC
  `) as ProjectDetail["goals"];

  const tickets = (await sql/* sql */ `
    SELECT id, slug, title, status, tier, current_step, agent
    FROM tickets
    WHERE project_id = ${project.id}
    ORDER BY slug ASC
  `) as ProjectDetail["tickets"];

  return json({ ...project, goals, tickets });
};
