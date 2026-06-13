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

/** Send a bot into a meeting. Returns Vexa's meeting object (id used as bot ref). */
export function createBot(
  env: VexaEnv,
  args: {
    platform: Platform;
    nativeMeetingId: string;
    language?: string;
    passcode?: string;
    botName?: string;
  },
): Promise<VexaResult<{ id?: number; status?: string }>> {
  return call(env, "POST", "/bots", {
    platform: args.platform,
    native_meeting_id: args.nativeMeetingId,
    ...(args.language ? { language: args.language } : {}),
    ...(args.passcode ? { passcode: args.passcode } : {}),
    ...(args.botName ? { bot_name: args.botName } : {}),
  });
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
