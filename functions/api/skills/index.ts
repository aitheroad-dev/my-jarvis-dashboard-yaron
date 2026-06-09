import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type SkillRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  body_chars: number;
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

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      id,
      slug,
      name,
      description,
      status,
      length(body) AS body_chars,
      created_at,
      updated_at
    FROM skills
    WHERE status <> 'archived'
    ORDER BY name ASC
    LIMIT 500
  `) as SkillRow[];

  return json(rows);
};
