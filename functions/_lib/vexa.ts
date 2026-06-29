/**
 * Vexa adapter — the only file that talks to the meeting-bot vendor.
 *
 * Hosted now (api.cloud.vexa.ai); self-hosted later is a VEXA_API_BASE swap —
 * Vexa is Apache-2.0 and its self-host deployment exposes the same REST API.
 * Errors never throw: every call returns { ok } so handlers degrade to the
 * D1-cached transcript instead of 500ing the page when the vendor is down.
 */

export interface VexaEnv {
  VEXA_API_BASE?: string;
  VEXA_API_KEY?: string;
}

export type Platform = "google_meet" | "zoom" | "teams";

export interface VexaSegment {
  start_time: number;
  end_time: number;
  text: string;
  language: string | null;
  speaker: string | null;
  completed: boolean;
  absolute_start_time: string | null;
  absolute_end_time: string | null;
}

export type VexaResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; detail: string };

export function vexaConfigured(env: VexaEnv): boolean {
  return typeof env.VEXA_API_KEY === "string" && env.VEXA_API_KEY.length > 0;
}

function base(env: VexaEnv): string {
  return (env.VEXA_API_BASE || "https://api.cloud.vexa.ai").replace(/\/+$/, "");
}

async function call<T>(
  env: VexaEnv,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<VexaResult<T>> {
  try {
    const res = await fetch(`${base(env)}${path}`, {
      method,
      headers: {
        "X-API-Key": env.VEXA_API_KEY ?? "",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(VEXA_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, status: res.status, detail: text.slice(0, 500) };
    }
    // DELETE /bots returns a plain acceptance message, not always JSON.
    const data = (text ? safeJson(text) : null) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Two distinct status sets — the distinction matters for correctness.
 *
 * RETRYABLE = safe to RE-POST /bots inline, because the request was rejected
 * BEFORE Vexa could create a bot, so a retry can't double-create or orphan one:
 *   401 auth rejected · 408 request-timeout · 429 rate-limited · 503 unavailable.
 * Vexa's hosted API intermittently answers 401 "Invalid API key" (and the odd
 * 503) for VALID keys — verified 2026-06-29: one live key returned 401·503·200×8
 * in a burst. Retrying these inline lets the bot still join on time instead of
 * failing the first attempts and joining minutes late. A genuinely-bad key 401s
 * on every retry and ends in the same 'failed' state ~1s later — no worse off.
 *
 * TRANSIENT (broader) = will likely RECOVER on the next cron tick, so the alert
 * gate should NOT page the owner: RETRYABLE ∪ {0 transport, 500/502/504 gateway}.
 * Those extra statuses are deliberately NOT inline-retried — a transport error
 * or 5xx can fire AFTER a bot was created, so re-POSTing might double it. They
 * fall through to the next-tick retry instead, which is double-safe via Vexa's
 * 409-idempotency + the partial unique index on active meetings.
 */
export const RETRYABLE_VEXA_STATUSES: ReadonlySet<number> = new Set([401, 408, 429, 503]);
export const TRANSIENT_VEXA_STATUSES: ReadonlySet<number> = new Set([
  0, 401, 408, 429, 500, 502, 503, 504,
]);

export function isRetryableVexaStatus(status: number): boolean {
  return RETRYABLE_VEXA_STATUSES.has(status);
}
export function isTransientVexaStatus(status: number): boolean {
  return TRANSIENT_VEXA_STATUSES.has(status);
}

// Bound any single Vexa call so a hung vendor can't stall the per-minute cron
// loop (Forge #4). A timeout surfaces as a transport-0 → not inline-retried,
// retried next tick instead.
const VEXA_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a bot into a meeting. Returns Vexa's meeting object (id used as bot ref).
 * Retries transient failures (see TRANSIENT_VEXA_STATUSES) with a short backoff
 * so Vexa's flaky-auth window doesn't delay or drop the join — default 3 total
 * attempts over ~1.2s, well inside one cron tick. A 409 means a bot already
 * exists for this meeting (a prior attempt's request actually landed) → treated
 * as success: stop/status/transcript all key off platform+native id, not bot id.
 */
export async function createBot(
  env: VexaEnv,
  args: {
    platform: Platform;
    nativeMeetingId: string;
    language?: string;
    passcode?: string;
    botName?: string;
  },
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<VexaResult<{ id?: number; status?: string }>> {
  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1);
  const backoffMs = opts.backoffMs ?? 400;
  const body = {
    platform: args.platform,
    native_meeting_id: args.nativeMeetingId,
    ...(args.language ? { language: args.language } : {}),
    ...(args.passcode ? { passcode: args.passcode } : {}),
    ...(args.botName ? { bot_name: args.botName } : {}),
  };
  let res!: VexaResult<{ id?: number; status?: string }>;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await call<{ id?: number; status?: string }>(env, "POST", "/bots", body);
    if (res.ok) return res;
    if (res.status === 409) return { ok: true, data: {} }; // already running — idempotent
    // Only re-POST statuses that are safe to repeat (no bot was created). Anything
    // else — including ambiguous transport/5xx errors — is surfaced now and left
    // to the next-tick retry, which is double-safe via 409 + the unique index.
    if (attempt >= maxAttempts || !isRetryableVexaStatus(res.status)) return res;
    await sleep(backoffMs * attempt); // 400ms, then 800ms
  }
  return res;
}

/** Ask the bot to leave. Vexa answers 202; tolerate 404 (already gone). */
export function stopBot(
  env: VexaEnv,
  platform: Platform,
  nativeMeetingId: string,
): Promise<VexaResult<unknown>> {
  return call(env, "DELETE", `/bots/${platform}/${encodeURIComponent(nativeMeetingId)}`);
}

interface RunningBot {
  platform?: string;
  native_meeting_id?: string;
}

/**
 * Is a bot currently running for this meeting? Vexa's GET /bots/status lists
 * live bot containers; a meeting whose bot is no longer listed has ended (the
 * call finished or everyone left, so Vexa's bot left too). Returns ok:false on
 * vendor error so callers can refuse to end a meeting on uncertainty.
 */
export async function botRunning(
  env: VexaEnv,
  platform: Platform,
  nativeMeetingId: string,
): Promise<VexaResult<boolean>> {
  const res = await call<{ running_bots?: RunningBot[] }>(env, "GET", "/bots/status");
  if (!res.ok) return res;
  const bots = Array.isArray(res.data?.running_bots) ? res.data.running_bots : [];
  const found = bots.some(
    (b) => b.platform === platform && b.native_meeting_id === nativeMeetingId,
  );
  return { ok: true, data: found };
}

/** Full transcript so far for a meeting (Vexa returns all segments each call). */
export async function fetchTranscript(
  env: VexaEnv,
  platform: Platform,
  nativeMeetingId: string,
): Promise<VexaResult<VexaSegment[]>> {
  const res = await call<{ segments?: VexaSegment[] }>(
    env,
    "GET",
    `/transcripts/${platform}/${encodeURIComponent(nativeMeetingId)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: Array.isArray(res.data?.segments) ? res.data.segments : [] };
}
