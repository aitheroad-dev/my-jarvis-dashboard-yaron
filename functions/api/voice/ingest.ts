import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  VOICE_INGEST_SECRET: string;
}

type IngestBody = {
  agent_name: string;
  text_content: string;
  title?: string | null;
  duration_seconds?: number | null;
  voice_id?: string | null;
  audio_url?: string | null;
  // Inline audio transport: base64 of the rendered Kokoro MP3. When present,
  // the bytes are stored in voice_samples.audio_data and audio_url is set to
  // this row's /api/voice/clip/<id> endpoint.
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
  // audio_url can point at this row's clip endpoint; decode(NULL,'base64')
  // yields NULL, so the same INSERT covers the text-only path.
  const id = crypto.randomUUID();
  let audioB64: string | null = null;
  let audioMime: string | null = null;
  let audioUrl = body.audio_url ?? "";
  if (typeof body.audio_b64 === "string" && body.audio_b64.length > 0) {
    if (body.audio_b64.length <= MAX_AUDIO_B64_LEN) {
      audioB64 = body.audio_b64;
      audioMime = body.audio_mime ?? "audio/mpeg";
      audioUrl = `/api/voice/clip/${id}`;
    }
    // oversize → fall through as a text-only row (audioUrl stays as given)
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    INSERT INTO voice_samples (
      id,
      user_id,
      agent_name,
      text_content,
      audio_url,
      audio_data,
      audio_mime,
      title,
      duration_seconds,
      category,
      voice_id,
      created_at
    ) VALUES (
      ${id}::uuid,
      'aitheroad@gmail.com',
      ${body.agent_name},
      ${body.text_content},
      ${audioUrl},
      decode(${audioB64}, 'base64'),
      ${audioMime},
      ${body.title ?? null},
      ${body.duration_seconds != null ? Math.round(body.duration_seconds) : null},
      ${body.category ?? 'message'},
      ${body.voice_id ?? null},
      ${body.created_at ?? new Date().toISOString()}
    )
    RETURNING id::text AS id, created_at
  `) as { id: string; created_at: string }[];

  return json(
    { ok: true, id: rows[0].id, created_at: rows[0].created_at, audio_url: audioUrl || null },
    { status: 201 },
  );
};
