import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type VoiceSample = {
  id: string;
  agent_name: string | null;
  text_content: string;
  audio_url: string | null;
  title: string | null;
  duration_seconds: number | null;
  category: string | null;
  voice_id: string | null;
  created_at: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    SELECT
      id::text AS id,
      agent_name,
      text_content,
      audio_url,
      title,
      duration_seconds,
      category,
      voice_id,
      created_at
    FROM voice_samples
    ORDER BY created_at DESC
    LIMIT 200
  `) as VoiceSample[];

  return json(rows);
};
