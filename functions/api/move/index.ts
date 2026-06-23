import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";
import {
  isMoveBucket,
  normalizeBuyOptions,
  serializeMoveRow,
  serializeMoveRows,
  type MoveTaskDbRow,
} from "../../_lib/move";

type MaxSeqRow = { max_seq: number | null };

type CreateMoveTaskBody = {
  bucket?: unknown;
  title?: unknown;
  owner?: unknown;
  due?: unknown;
  notes?: unknown;
  buy_options?: unknown;
};

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
      SELECT id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version, buy_options
        FROM move_tasks
       ORDER BY bucket ASC, seq ASC
       LIMIT 1000
    `) as MoveTaskDbRow[];

    return json(serializeMoveRows(rows));
  } catch (err) {
    return json(
      { error: "move tasks fetch failed", detail: err instanceof Error ? err.message : String(err) },
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

  let body: CreateMoveTaskBody;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    body = raw as CreateMoveTaskBody;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!isMoveBucket(body.bucket)) {
    return json({ error: "bucket must be one of A, B, C, D" }, { status: 400 });
  }

  if (typeof body.title !== "string" || body.title.trim() === "") {
    return json({ error: "title is required" }, { status: 400 });
  }

  const buy = normalizeBuyOptions(body.buy_options);
  if (!buy.ok) return json({ error: buy.error }, { status: 400 });

  try {
    const sql = getDb(env);
    const maxRows = (await sql/* sql */ `
      SELECT MAX(seq) AS max_seq FROM move_tasks WHERE bucket = ${body.bucket}
    `) as MaxSeqRow[];
    const seq = (maxRows[0]?.max_seq ?? -1) + 1;
    const id = crypto.randomUUID();
    const rows = (await sql/* sql */ `
      INSERT INTO move_tasks (id, bucket, seq, title, owner, due, status, notes, buy_options)
      VALUES (
        ${id},
        ${body.bucket},
        ${seq},
        ${body.title.trim()},
        ${optionalText(body.owner)},
        ${optionalText(body.due)},
        'todo',
        ${optionalText(body.notes)},
        ${buy.json}
      )
      RETURNING id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version, buy_options
    `) as MoveTaskDbRow[];

    return json(serializeMoveRow(rows[0]), { status: 201 });
  } catch (err) {
    return json(
      { error: "move task create failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
