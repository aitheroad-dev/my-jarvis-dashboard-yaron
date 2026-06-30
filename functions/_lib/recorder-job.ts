// recorder-job.ts — the multi-tenant recorder JOB CONTRACT + HMAC callback auth.
//
// This is the fork's HALF of the contract that lets the shared box recorder share
// COMPUTE without ever holding this fork's DATA token (see the pai-meeting-recorder
// MULTITENANT_RECORDER_DESIGN.md / ISA_MULTITENANT.md). The dashboard:
//   - PRODUCES jobs (enqueue on POST /api/meetings) onto the shared CF Queue, and
//   - CONSUMES the box's callbacks at POST /api/recordings/ingest.
// The box carries only job metadata + the per-fork HMAC key for the narrow callback;
// it never gets this fork's D1 token.
//
// SHARED SHAPE: keep JobContract + the HMAC scheme byte-identical with the box's
// transcriber/job-contract.ts. The box signs with node:crypto; we verify with Web
// Crypto — both over `${timestamp}.${rawBody}` so they interoperate.

import type { Queue } from "@cloudflare/workers-types";

/** What the dashboard enqueues; what the box pulls. Coordination metadata only. */
export interface JobContract {
  job_id: string; // uuid — tenant-scoped correlation key (replaces mtg-<id>)
  tenant_id: string; // which fork this job belongs to
  meeting_url: string;
  platform: string | null;
  native_id: string | null;
  language: string | null; // he|en|auto|es|fr|de ; null = box default (he)
  ingest_url: string; // this fork's POST /api/recordings/ingest
  ingest_secret: string; // per-fork HMAC key for the callback (not a DB token)
  created_at: string; // ISO
  attempts: number; // producer sets 0
}

// ---- ingest callback payloads (box → fork) ----------------------------------
export type IngestStatus = "starting" | "transcribing" | "failed";

export interface StatusMessage {
  kind: "status";
  job_id: string;
  status: IngestStatus;
  last_error?: string | null;
  error_status?: number | null;
}

export interface ResultMessage {
  kind: "result";
  job_id: string;
  bot_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration?: number | null;
  transcript: {
    language?: string | null;
    duration?: number | null;
    model?: string | null;
    segments: { start: number | null; end: number | null; text: string }[];
    text?: string;
  };
}

export type IngestMessage = StatusMessage | ResultMessage;

// ---- HMAC (interoperates with the box's node:crypto HMAC) --------------------
const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign `${timestamp}.${rawBody}` — matches the box's node:crypto HMAC. */
export function signIngest(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}

/** Constant-time hex compare (avoids early-exit timing leak). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MAX_SKEW_MS = 5 * 60 * 1000; // replay guard window

/** Verify an ingest callback: HMAC over `${ts}.${body}` + timestamp freshness. */
export async function verifyIngest(
  secret: string,
  timestamp: string | null,
  sigHex: string | null,
  rawBody: string,
  nowMs: number,
): Promise<boolean> {
  if (!secret || !timestamp || !sigHex) return false; // fail closed
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > MAX_SKEW_MS) return false;
  const expected = await signIngest(secret, timestamp, rawBody);
  return timingSafeEqualHex(expected, sigHex);
}

/** Producer/consumer env this fork needs for the recorder control plane. */
export interface RecorderProducerEnv {
  RECORDER_QUEUE?: Queue<JobContract>;
  INGEST_SECRET?: string;
  RECORDER_TENANT_ID?: string;
  RECORDER_INGEST_URL?: string;
}
