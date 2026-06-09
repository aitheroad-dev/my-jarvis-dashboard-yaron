/**
 * /api/mcp-activity — the MCP audit feed.
 *
 * Migrated off legacy Supabase Edge Function (was xtkfuchjmeekofeuplfu).
 *
 *   GET  — authenticated dashboard user. Returns the latest 100 activity rows
 *          for the tenant query param (defaults to "(unprovisioned)" guard).
 *   POST — header-auth via X-MCP-Secret. The MCP Worker posts every audit event
 *          here. Single-tenant for now; tenant_id comes from the body.
 */
import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  MCP_WORKER_SECRET: string;
}

const ALLOWED_OP_TYPES = new Set([
  "write_file",
  "push_files",
  "ship",
  "apply_migration",
  "query_db",
  "destructive_push",
  "delete_file",
  "upload_asset",
]);
const ALLOWED_STATUS = new Set(["success", "failed", "escalated"]);
const DEFAULT_LIMIT = 100;

type McpActivityRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  op_type: string;
  status: string;
  payload: string | null;
  result: string | null;
  duration_ms: number | null;
  mcp_session_id: string | null;
  chat_id: string | null;
  created_at: string;
};

// ── GET ────────────────────────────────────────────────────────────────────
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const url = new URL(request.url);
  const tenant = url.searchParams.get("tenant") ?? "erezfern";
  const limitRaw: string | null = url.searchParams.get("limit");
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? DEFAULT_LIMIT
      : Math.min(limitParsed, 1000);

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT
      id,
      tenant_id,
      user_id,
      op_type,
      status,
      payload,
      result,
      duration_ms,
      mcp_session_id,
      chat_id,
      created_at
    FROM mcp_activity
    WHERE tenant_id = ${tenant}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as McpActivityRow[];

  return json(
    rows.map((row) => ({
      ...row,
      payload: row.payload ? JSON.parse(row.payload) : {},
      result: row.result ? JSON.parse(row.result) : null,
    })),
  );
};

// ── POST ───────────────────────────────────────────────────────────────────
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Header auth — MCP Worker uses X-MCP-Secret. No user JWT.
  const secret = request.headers.get("X-MCP-Secret") ?? "";
  if (!env.MCP_WORKER_SECRET || secret !== env.MCP_WORKER_SECRET) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    tenant_id?: unknown;
    user_id?: unknown;
    op_type?: unknown;
    status?: unknown;
    payload?: unknown;
    result?: unknown;
    duration_ms?: unknown;
    mcp_session_id?: unknown;
    chat_id?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const tenant_id = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const op_type = typeof body.op_type === "string" ? body.op_type : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!tenant_id) return json({ error: "tenant_id_required" }, { status: 400 });
  if (!ALLOWED_OP_TYPES.has(op_type)) {
    return json({ error: "invalid_op_type", got: op_type }, { status: 400 });
  }
  if (!ALLOWED_STATUS.has(status)) {
    return json({ error: "invalid_status", got: status }, { status: 400 });
  }

  const user_id = typeof body.user_id === "string" ? body.user_id : null;
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const result = body.result && typeof body.result === "object" ? body.result : null;
  const duration_ms = typeof body.duration_ms === "number" ? body.duration_ms : null;
  const mcp_session_id = typeof body.mcp_session_id === "string" ? body.mcp_session_id : null;
  const chat_id = typeof body.chat_id === "string" ? body.chat_id : null;

  const sql = getDb(env);
  const inserted = await sql/* sql */ `
    INSERT INTO mcp_activity (
      tenant_id, user_id, op_type, status,
      payload, result, duration_ms, mcp_session_id, chat_id
    ) VALUES (
      ${tenant_id}, ${user_id}, ${op_type}, ${status},
      ${JSON.stringify(payload)},
      ${result ? JSON.stringify(result) : null},
      ${duration_ms}, ${mcp_session_id}, ${chat_id}
    )
    RETURNING id, created_at
  `;

  return json(inserted[0], { status: 201 });
};
