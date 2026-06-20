import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type MoveStatus = "todo" | "doing" | "done";

type MoveTaskRow = {
  id: string;
  bucket: "A" | "B" | "C" | "D";
  seq: number;
  title: string;
  owner: string | null;
  due: string | null;
  status: MoveStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PatchMoveTaskBody = {
  title?: unknown;
  owner?: unknown;
  due?: unknown;
  status?: unknown;
  notes?: unknown;
};

const STATUSES: MoveStatus[] = ["todo", "doing", "done"];

function hasOwn(body: PatchMoveTaskBody, key: keyof PatchMoveTaskBody): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function optionalTextFromPatch(body: PatchMoveTaskBody, key: "owner" | "due" | "notes"): string | null {
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isMoveStatus(value: unknown): value is MoveStatus {
  return typeof value === "string" && STATUSES.includes(value as MoveStatus);
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

  let body: PatchMoveTaskBody;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    body = raw as PatchMoveTaskBody;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (hasOwn(body, "title") && (typeof body.title !== "string" || body.title.trim() === "")) {
    return json({ error: "title must be a non-empty string" }, { status: 400 });
  }

  if (hasOwn(body, "status") && !isMoveStatus(body.status)) {
    return json({ error: "status must be one of todo, doing, done" }, { status: 400 });
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      UPDATE move_tasks
         SET title = CASE WHEN ${hasOwn(body, "title")} THEN ${typeof body.title === "string" ? body.title.trim() : null} ELSE title END,
             owner = CASE WHEN ${hasOwn(body, "owner")} THEN ${optionalTextFromPatch(body, "owner")} ELSE owner END,
             due = CASE WHEN ${hasOwn(body, "due")} THEN ${optionalTextFromPatch(body, "due")} ELSE due END,
             status = CASE WHEN ${hasOwn(body, "status")} THEN ${body.status} ELSE status END,
             notes = CASE WHEN ${hasOwn(body, "notes")} THEN ${optionalTextFromPatch(body, "notes")} ELSE notes END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ${id}
       RETURNING id, bucket, seq, title, owner, due, status, notes, created_at, updated_at
    `) as MoveTaskRow[];

    if (rows.length === 0) return json({ error: "not found" }, { status: 404 });
    return json(rows[0]);
  } catch (err) {
    return json(
      { error: "move task update failed", detail: err instanceof Error ? err.message : String(err) },
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
      DELETE FROM move_tasks
       WHERE id = ${id}
       RETURNING id
    `) as { id: string }[];

    if (rows.length === 0) return json({ error: "not found" }, { status: 404 });
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: "move task delete failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
