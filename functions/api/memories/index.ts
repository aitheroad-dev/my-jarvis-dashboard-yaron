import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type MemoryRow = {
  id: string;
  agent: string | null;
  type:
    | "session_log"
    | "learning"
    | "user_fact"
    | "area"
    | "principle"
    | "identity";
  title: string | null;
  body: string;
  metadata: string | null;
  created_at: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const url = new URL(request.url);
  const agent = url.searchParams.get("agent");
  const type = url.searchParams.get("type");
  const limitRaw: string | null = url.searchParams.get("limit");
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? 500
      : Math.min(limitParsed, 1000);

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      id,
      agent,
      type,
      title,
      body,
      metadata,
      created_at
    FROM memories
    WHERE (${agent} IS NULL OR agent = ${agent})
      AND (${type} IS NULL OR type = ${type})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as MemoryRow[];

  return json(
    rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    })),
  );
};
