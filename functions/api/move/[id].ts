import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";
import {
  isMoveBucket,
  isMoveStatus,
  normalizeBuyOptions,
  normalizeChecklist,
  serializeMoveRow,
  type MoveBucket,
  type MoveTaskDbRow,
} from "../../_lib/move";

type PatchMoveTaskBody = {
  title?: unknown;
  owner?: unknown;
  due?: unknown;
  status?: unknown;
  notes?: unknown;
  // Move a task to a different section. When the bucket actually changes, seq is
  // recomputed to the bottom of the target bucket.
  bucket?: unknown;
  // Full replacement of the purchase options (array of {label,url,price?}) or null.
  buy_options?: unknown;
  // Full replacement of the detail checklist (array of {label,info?,done}) or null.
  checklist?: unknown;
  // Optimistic concurrency: the integer version the client last saw for this row.
  base_version?: unknown;
};

type MaxSeqRow = { max_seq: number | null };

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

  const hasBucket = hasOwn(body, "bucket");
  if (hasBucket && !isMoveBucket(body.bucket)) {
    return json({ error: "bucket must be one of A, B, C, D" }, { status: 400 });
  }
  const nextBucket = hasBucket ? (body.bucket as MoveBucket) : null;

  const hasBuy = hasOwn(body, "buy_options");
  const buy = hasBuy ? normalizeBuyOptions(body.buy_options) : null;
  if (buy && !buy.ok) return json({ error: buy.error }, { status: 400 });
  const buyJson = buy && buy.ok ? buy.json : null;

  const hasChecklist = hasOwn(body, "checklist");
  const checklist = hasChecklist ? normalizeChecklist(body.checklist) : null;
  if (checklist && !checklist.ok) return json({ error: checklist.error }, { status: 400 });
  const checklistJson = checklist && checklist.ok ? checklist.json : null;

  // Optimistic-concurrency guard: when the client sends the version it last saw,
  // the UPDATE only lands if the row's version still matches. Null = no guard.
  const baseVersion =
    typeof body.base_version === "number" && Number.isInteger(body.base_version) && body.base_version >= 0
      ? body.base_version
      : null;

  try {
    const sql = getDb(env);

    // For a move, recompute seq to the bottom of the target bucket — but only when
    // the bucket actually changes (so a no-op bucket PATCH doesn't reshuffle).
    let moveSeq: number | null = null;
    if (nextBucket) {
      const currentRows = (await sql/* sql */ `
        SELECT bucket FROM move_tasks WHERE id = ${id}
      `) as { bucket: MoveBucket }[];
      if (currentRows.length && currentRows[0].bucket !== nextBucket) {
        const maxRows = (await sql/* sql */ `
          SELECT MAX(seq) AS max_seq FROM move_tasks WHERE bucket = ${nextBucket}
        `) as MaxSeqRow[];
        moveSeq = (maxRows[0]?.max_seq ?? -1) + 1;
      }
    }
    const applyMove = nextBucket !== null && moveSeq !== null;

    const rows = (await sql/* sql */ `
      UPDATE move_tasks
         SET title = CASE WHEN ${hasOwn(body, "title")} THEN ${typeof body.title === "string" ? body.title.trim() : null} ELSE title END,
             owner = CASE WHEN ${hasOwn(body, "owner")} THEN ${optionalTextFromPatch(body, "owner")} ELSE owner END,
             due = CASE WHEN ${hasOwn(body, "due")} THEN ${optionalTextFromPatch(body, "due")} ELSE due END,
             status = CASE WHEN ${hasOwn(body, "status")} THEN ${body.status} ELSE status END,
             notes = CASE WHEN ${hasOwn(body, "notes")} THEN ${optionalTextFromPatch(body, "notes")} ELSE notes END,
             buy_options = CASE WHEN ${hasBuy} THEN ${buyJson} ELSE buy_options END,
             checklist = CASE WHEN ${hasChecklist} THEN ${checklistJson} ELSE checklist END,
             bucket = CASE WHEN ${applyMove} THEN ${nextBucket} ELSE bucket END,
             seq = CASE WHEN ${applyMove} THEN ${moveSeq} ELSE seq END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             version = version + 1
       WHERE id = ${id}
         AND (${baseVersion} IS NULL OR version = ${baseVersion})
       RETURNING id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version, buy_options, checklist
    `) as MoveTaskDbRow[];

    if (rows.length === 0) {
      // 0 rows = either the row is gone (404) or it changed under the client (409).
      const existing = (await sql/* sql */ `
        SELECT id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version, buy_options, checklist
          FROM move_tasks
         WHERE id = ${id}
      `) as MoveTaskDbRow[];
      if (existing.length === 0) return json({ error: "not found" }, { status: 404 });
      return json(
        { error: "version conflict", conflict: true, current: serializeMoveRow(existing[0]) },
        { status: 409 },
      );
    }
    return json(serializeMoveRow(rows[0]));
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
