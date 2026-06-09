import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  VOICE_INGEST_SECRET: string;
}

type IngestBody = {
  // Optional client-provided row id. When present it becomes the row's id and
  // the INSERT upserts on conflict — so a retried POST (after a lost ack) is
  // idempotent and never duplicates. The local pai-voice outbox owns this id.
  id?: string | null;
  agent_name: string;
  text_content: string;
  title?: string | null;
  duration_seconds?: number | null;
  voice_id?: string | null;
  audio_url?: string | null;
  // Inline audio transport: base64 of the rendered Kokoro MP3. When present,
  // the bytes are stored in R2 and audio_url is set to the public object URL.
  audio_b64?: string | null;
  audio_mime?: string | null;
  category?: string | null;
  created_at?: string | null;
};

// Guardrail: base64 of a Kokoro MP3. ~2MB of base64 ≈ 1.5MB of audio — far
// above any real clip; drop the audio (keep the text row) if it's larger.
const MAX_AUDIO_B64_LEN = 2_000_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const provided = request.headers.get("X-Voice-Ingest-Secret");
  if (!env.VOICE_INGEST_SECRET) {
    return new Response(
      JSON.stringify({ error: "server_misconfigured", reason: "VOICE_INGEST_SECRET not set" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  if (provided !== env.VOICE_INGEST_SECRET) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body.agent_name || !body.text_content) {
    return new Response(
      JSON.stringify({ error: "missing_fields", required: ["agent_name", "text_content"] }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // Decide audio transport. With inline bytes, generate the id up front so
  // the R2 object key and public audio_url use the same stable identifier.
  // Use the client-provided id when present (idempotent retries); else mint one.
  const clientId =
    typeof body.id === "string" && /^[0-9a-fA-F-]{36}$/.test(body.id) ? body.id : null;
  const id = clientId ?? crypto.randomUUID();
  let audioB64: string | null = null;
  let audioMime: string | null = null;
  let audioUrl = body.audio_url ?? "";
  if (typeof body.audio_b64 === "string" && body.audio_b64.length > 0) {
    if (body.audio_b64.length <= MAX_AUDIO_B64_LEN) {
      audioB64 = body.audio_b64;
      audioMime = body.audio_mime ?? "audio/mpeg";
    }
    // oversize → fall through as a text-only row (audioUrl stays as given)
  }

  if (audioB64) {
    try {
      const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
      await env.VOICE_BUCKET.put(`${id}.mp3`, bytes, {
        httpMetadata: { contentType: audioMime || "audio/mpeg" },
      });
      audioUrl = `${env.VOICE_PUBLIC_URL}/${id}.mp3`;
    } catch {
      // Keep the text row and any client-provided URL when R2 storage fails.
    }
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    INSERT INTO voice_samples (
      id,
      user_id,
      agent_name,
      text_content,
      audio_url,
      title,
      duration_seconds,
      category,
      voice_id,
      created_at
    ) VALUES (
      ${id},
      'aitheroad@gmail.com',
      ${body.agent_name},
      ${body.text_content},
      ${audioUrl},
      ${body.title ?? null},
      ${body.duration_seconds != null ? Math.round(body.duration_seconds) : null},
      ${body.category ?? 'message'},
      ${body.voice_id ?? null},
      ${body.created_at ?? new Date().toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id, created_at
  `) as { id: string; created_at: string }[];

  // No row back → this id already landed. Idempotent success, not an error.
  if (rows.length === 0) {
    return json(
      { ok: true, id, duplicate: true, audio_url: audioUrl || null },
      { status: 200 },
    );
  }

  return json(
    { ok: true, id: rows[0].id, created_at: rows[0].created_at, audio_url: audioUrl || null },
    { status: 201 },
  );
};
