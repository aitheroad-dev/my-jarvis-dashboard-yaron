// Shared types + helpers for the /move tracker (REST endpoints + NL agent).
// Centralizes bucket/status validation, buy_options parsing/normalization, and
// row serialization so all four SQL surfaces stay in lockstep.

export type MoveBucket = "A" | "B" | "C" | "D";
export type MoveStatus = "todo" | "doing" | "done";

export const BUCKETS: MoveBucket[] = ["A", "B", "C", "D"];
export const STATUSES: MoveStatus[] = ["todo", "doing", "done"];

// Owner is stored as the Hebrew label directly (live data uses these). null = unassigned.
export const OWNERS = ["ירון", "נועה", "שנינו"] as const;

// A single purchase option shown in the buy popup.
export type BuyOption = { label: string; url: string; price?: string | null };
export const MAX_BUY_OPTIONS = 4;

// Row as stored in D1 (buy_options is raw JSON text or null).
export type MoveTaskDbRow = {
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
  buy_options: string | null;
};

// Row as returned to the client (buy_options parsed into an array or null).
export type MoveTaskOut = Omit<MoveTaskDbRow, "buy_options"> & {
  buy_options: BuyOption[] | null;
};

export function isMoveBucket(value: unknown): value is MoveBucket {
  return typeof value === "string" && BUCKETS.includes(value as MoveBucket);
}

export function isMoveStatus(value: unknown): value is MoveStatus {
  return typeof value === "string" && STATUSES.includes(value as MoveStatus);
}

// Parse a stored buy_options TEXT value into a clean array for API output.
export function parseBuyOptions(raw: unknown): BuyOption[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const out: BuyOption[] = [];
  for (const item of arr.slice(0, MAX_BUY_OPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rawUrl = typeof o.url === "string" ? o.url.trim() : "";
    if (!rawUrl) continue;
    // Defense-in-depth: only surface http(s) links even on the way OUT, so a value
    // written straight to the DB can never render javascript:/data: as an <a href>.
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : parsed.hostname;
    const price = typeof o.price === "string" && o.price.trim() ? o.price.trim() : null;
    out.push({ label, url: parsed.toString(), price });
  }
  return out.length ? out : null;
}

// Validate + normalize a buy_options INPUT into a JSON string for storage (or null).
// Drops malformed entries and any non-http(s) URL. Caps at MAX_BUY_OPTIONS.
export function normalizeBuyOptions(
  value: unknown,
): { ok: true; json: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, json: null };
  if (!Array.isArray(value)) return { ok: false, error: "buy_options must be an array" };
  const out: BuyOption[] = [];
  for (const item of value.slice(0, MAX_BUY_OPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rawUrl = typeof o.url === "string" ? o.url.trim() : "";
    if (!rawUrl) continue;
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : parsed.hostname;
    const price = typeof o.price === "string" && o.price.trim() ? o.price.trim() : null;
    out.push({ label, url: parsed.toString(), price });
  }
  return { ok: true, json: out.length ? JSON.stringify(out) : null };
}

// DB row → client row (parse buy_options).
export function serializeMoveRow(row: MoveTaskDbRow): MoveTaskOut {
  const { buy_options, ...rest } = row;
  return { ...rest, buy_options: parseBuyOptions(buy_options) };
}

export function serializeMoveRows(rows: MoveTaskDbRow[]): MoveTaskOut[] {
  return rows.map(serializeMoveRow);
}
