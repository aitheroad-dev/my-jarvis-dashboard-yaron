import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

/**
 * Natural-language agent for the /move tracker.
 *
 * Yaron OR Noa types an instruction ("add three packing items", "mark the boiler
 * done"); a Workers-AI model turns it into a list of operations over move_tasks,
 * which the SERVER validates and executes. The model can ONLY emit the four
 * whitelisted ops below — it never authors SQL and can never touch any table but
 * move_tasks, so a weird/injected instruction's worst case is a junk row deleted
 * in one tap. Auth/RBAC are inherited: requireUser admits owner (admin) + Noa
 * (move), and _middleware.ts already grants the "move" page the /api/move prefix
 * that this /api/move/agent path matches — so no auth change is needed.
 *
 * Decision = apply-immediately (no preview): ops run, then a summary + the fresh
 * list are returned. Undo is normal editing/delete.
 */

type MoveBucket = "A" | "B" | "C" | "D";
type MoveStatus = "todo" | "doing" | "done";

type MoveTaskRow = {
  id: string;
  bucket: MoveBucket;
  seq: number;
  title: string;
  owner: string | null;
  due: string | null;
  status: MoveStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type MaxSeqRow = { max_seq: number | null };

const BUCKETS: MoveBucket[] = ["A", "B", "C", "D"];
const STATUSES: MoveStatus[] = ["todo", "doing", "done"];

// In-platform Workers AI model. Instruction-following + json mode, EU edge.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_INSTRUCTION = 2000;
const MAX_OPS = 25; // blast-radius cap per call

// Hebrew label + short English gloss so the model can map "packing" → D, etc.
const BUCKET_GUIDE: Record<MoveBucket, string> = {
  A: "מסירת הבית (קלוסטרהוף) / handover of the OLD house",
  B: "תשתיות וכתובת / utilities & address change",
  C: "הבית החדש / the NEW house",
  D: "אריזה ולוגיסטיקה / packing & logistics",
};

type AddOp = { action: "add"; bucket: MoveBucket; title: string; owner?: string | null; due?: string | null; notes?: string | null };
type UpdateOp = { action: "update"; ref: number; title?: string; owner?: string | null; due?: string | null; notes?: string | null };
type StatusOp = { action: "status"; ref: number; status: MoveStatus };
type DeleteOp = { action: "delete"; ref: number };

type AppliedOp = { action: string; detail: string };
type SkippedOp = { reason: string; raw: unknown };

function isBucket(v: unknown): v is MoveBucket {
  return typeof v === "string" && BUCKETS.includes(v as MoveBucket);
}
function isStatus(v: unknown): v is MoveStatus {
  return typeof v === "string" && STATUSES.includes(v as MoveStatus);
}
function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

// Pull a JSON object out of model output even when it's fenced or has stray
// prose around it. Returns null if nothing parses.
function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let s = text.trim();
  // strip ```json ... ``` / ``` ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // try whole string, then the first {...last } slice
  const candidates = [s];
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function buildSystemPrompt(tasks: MoveTaskRow[]): string {
  const guide = BUCKETS.map((b) => `${b} = ${BUCKET_GUIDE[b]}`).join("\n");
  const list =
    tasks.length === 0
      ? "(the list is currently empty)"
      : tasks
          .map((t, i) => `${i + 1} | ${t.bucket} | ${t.status} | ${t.title}`)
          .join("\n");
  return [
    "You edit a shared house-move checklist. It has exactly 4 buckets:",
    guide,
    "",
    "Current items (ref | bucket | status | title):",
    list,
    "",
    "The user gives an instruction in Hebrew or English. Translate it into a list of operations.",
    "Respond with ONLY a JSON object — no prose, no markdown fences — of this exact shape:",
    '{"ops":[ ... ],"summary":"<one short sentence in Hebrew describing what you did>"}',
    "Each op is exactly one of:",
    '{"action":"add","bucket":"A|B|C|D","title":"...","owner":null,"due":null,"notes":null}',
    '{"action":"update","ref":N,"title":"...","owner":null,"due":null,"notes":null}   (include ONLY the fields you are changing)',
    '{"action":"status","ref":N,"status":"todo|doing|done"}',
    '{"action":"delete","ref":N}',
    "Rules:",
    "- Keep titles in the user's language; Hebrew input → Hebrew titles.",
    "- 'packing' → bucket D unless the user says otherwise. Pick the best-fit bucket when unsure.",
    "- ref MUST be one of the existing ref numbers listed above. Never invent a ref.",
    "- Emit ONLY the operations the instruction asks for. If it asks for nothing actionable, return an empty ops array.",
  ].join("\n");
}

type AiTextResult = { response?: unknown };

async function runModel(env: Env, instruction: string, system: string, jsonMode: boolean): Promise<string> {
  const opts: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: instruction },
    ],
    max_tokens: 1024,
    temperature: 0.1,
  };
  if (jsonMode) opts.response_format = { type: "json_object" };
  const res = (await env.AI.run(MODEL, opts as never)) as AiTextResult;
  return typeof res?.response === "string" ? res.response : JSON.stringify(res);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  // ---- parse body ----
  let instruction: string;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    const value = (raw as { instruction?: unknown }).instruction;
    if (typeof value !== "string" || value.trim() === "") {
      return json({ error: "instruction is required" }, { status: 400 });
    }
    if (value.length > MAX_INSTRUCTION) {
      return json({ error: `instruction too long (max ${MAX_INSTRUCTION} chars)` }, { status: 400 });
    }
    instruction = value.trim();
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sql = getDb(env);

  // ---- load current list (gives the model its context + the ref map) ----
  let tasks: MoveTaskRow[];
  try {
    tasks = (await sql/* sql */ `
      SELECT id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version
        FROM move_tasks
       ORDER BY bucket ASC, seq ASC
    `) as MoveTaskRow[];
  } catch (err) {
    return json(
      { error: "failed to load move tasks", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // ref (1-based, matches the prompt) → real row
  const byRef = new Map<number, MoveTaskRow>();
  tasks.forEach((t, i) => byRef.set(i + 1, t));

  // ---- ask the model for a plan (json mode, one fallback retry) ----
  const system = buildSystemPrompt(tasks);
  let plan: Record<string, unknown> | null = null;
  try {
    plan = extractJson(await runModel(env, instruction, system, true));
  } catch {
    plan = null;
  }
  if (!plan) {
    try {
      plan = extractJson(
        await runModel(env, instruction, system + "\n\nReturn ONLY valid JSON. No explanation.", false),
      );
    } catch {
      plan = null;
    }
  }
  if (!plan || !Array.isArray((plan as { ops?: unknown }).ops)) {
    return json(
      { error: "לא הצלחתי להבין את ההוראה. נסה לנסח אותה אחרת." },
      { status: 422 },
    );
  }

  const rawOps = ((plan as { ops: unknown[] }).ops).slice(0, MAX_OPS);
  const applied: AppliedOp[] = [];
  const skipped: SkippedOp[] = [];
  const counts = { added: 0, updated: 0, statusChanged: 0, deleted: 0 };

  // ---- validate + execute each op (only the 4 whitelisted shapes touch the DB) ----
  for (const opUnknown of rawOps) {
    if (!opUnknown || typeof opUnknown !== "object") {
      skipped.push({ reason: "not an object", raw: opUnknown });
      continue;
    }
    const op = opUnknown as { action?: unknown };
    try {
      if (op.action === "add") {
        const a = op as AddOp;
        if (!isBucket(a.bucket)) { skipped.push({ reason: "bad bucket", raw: op }); continue; }
        const title = cleanText(a.title);
        if (!title) { skipped.push({ reason: "empty title", raw: op }); continue; }
        const maxRows = (await sql/* sql */ `
          SELECT MAX(seq) AS max_seq FROM move_tasks WHERE bucket = ${a.bucket}
        `) as MaxSeqRow[];
        const seq = (maxRows[0]?.max_seq ?? -1) + 1;
        await sql/* sql */ `
          INSERT INTO move_tasks (id, bucket, seq, title, owner, due, status, notes)
          VALUES (${crypto.randomUUID()}, ${a.bucket}, ${seq}, ${title},
                  ${cleanText(a.owner)}, ${cleanText(a.due)}, 'todo', ${cleanText(a.notes)})
        `;
        counts.added++;
        applied.push({ action: "add", detail: `${a.bucket}: ${title}` });
        continue;
      }

      if (op.action === "update") {
        const u = op as UpdateOp;
        const row = byRef.get(u.ref);
        if (!row) { skipped.push({ reason: "unknown ref", raw: op }); continue; }
        const hasTitle = Object.prototype.hasOwnProperty.call(u, "title");
        const hasOwner = Object.prototype.hasOwnProperty.call(u, "owner");
        const hasDue = Object.prototype.hasOwnProperty.call(u, "due");
        const hasNotes = Object.prototype.hasOwnProperty.call(u, "notes");
        if (!hasTitle && !hasOwner && !hasDue && !hasNotes) {
          skipped.push({ reason: "no fields to update", raw: op });
          continue;
        }
        const nextTitle = hasTitle ? cleanText(u.title) : row.title;
        if (hasTitle && !nextTitle) { skipped.push({ reason: "empty title", raw: op }); continue; }
        await sql/* sql */ `
          UPDATE move_tasks
             SET title = ${nextTitle},
                 owner = ${hasOwner ? cleanText(u.owner) : row.owner},
                 due = ${hasDue ? cleanText(u.due) : row.due},
                 notes = ${hasNotes ? cleanText(u.notes) : row.notes},
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                 version = version + 1
           WHERE id = ${row.id}
        `;
        counts.updated++;
        applied.push({ action: "update", detail: `${row.title}` });
        continue;
      }

      if (op.action === "status") {
        const s = op as StatusOp;
        const row = byRef.get(s.ref);
        if (!row) { skipped.push({ reason: "unknown ref", raw: op }); continue; }
        if (!isStatus(s.status)) { skipped.push({ reason: "bad status", raw: op }); continue; }
        await sql/* sql */ `
          UPDATE move_tasks
             SET status = ${s.status},
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                 version = version + 1
           WHERE id = ${row.id}
        `;
        counts.statusChanged++;
        applied.push({ action: "status", detail: `${row.title} → ${s.status}` });
        continue;
      }

      if (op.action === "delete") {
        const d = op as DeleteOp;
        const row = byRef.get(d.ref);
        if (!row) { skipped.push({ reason: "unknown ref", raw: op }); continue; }
        // RETURNING so a duplicate/stale ref (model emitted the same row twice)
        // is a no-op we DON'T count — keeps the summary count honest.
        const removed = (await sql/* sql */ `
          DELETE FROM move_tasks WHERE id = ${row.id} RETURNING id
        `) as { id: string }[];
        if (removed.length === 0) { skipped.push({ reason: "already removed", raw: op }); continue; }
        counts.deleted++;
        applied.push({ action: "delete", detail: `${row.title}` });
        continue;
      }

      skipped.push({ reason: "unknown action", raw: op });
    } catch (err) {
      skipped.push({ reason: err instanceof Error ? err.message : "execution error", raw: op });
    }
  }

  // ---- fresh list back to the client (apply-immediately: UI just re-renders) ----
  let fresh: MoveTaskRow[] = [];
  let refreshError: string | null = null;
  try {
    fresh = (await sql/* sql */ `
      SELECT id, bucket, seq, title, owner, due, status, notes, created_at, updated_at, version
        FROM move_tasks
       ORDER BY bucket ASC, seq ASC
    `) as MoveTaskRow[];
  } catch (err) {
    refreshError = err instanceof Error ? err.message : String(err);
  }

  return json({
    summary: counts,
    note: typeof (plan as { summary?: unknown }).summary === "string" ? (plan as { summary: string }).summary : null,
    applied,
    skipped,
    tasks: fresh,
    refreshError,
  });
};
