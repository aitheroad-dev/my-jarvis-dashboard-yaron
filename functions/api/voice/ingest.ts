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
  category?: string | null;
  created_at?: string | null;
};

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

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    INSERT INTO voice_samples (
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
      'aitheroad@gmail.com',
      ${body.agent_name},
      ${body.text_content},
      ${body.audio_url ?? ""},
      ${body.title ?? null},
      ${body.duration_seconds ?? null},
      ${body.category ?? 'message'},
      ${body.voice_id ?? null},
      ${body.created_at ?? new Date().toISOString()}
    )
    RETURNING id::text AS id, created_at
  `) as { id: string; created_at: string }[];

  return json({ ok: true, id: rows[0].id, created_at: rows[0].created_at }, { status: 201 });
};
