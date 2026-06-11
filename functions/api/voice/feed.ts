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

  const url = new URL(request.url);
  const limitRaw: string | null = url.searchParams.get("limit");
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? 50
      : Math.min(limitParsed, 1000);

  // Audio retention: R2 objects expire after 90 days (lifecycle rule
  // 'expire-audio-90d' on the voice bucket), so mask audio_url for older rows
  // at read time — text stays forever, but we never hand the UI a play button
  // whose object has aged out. '' is the established "no audio" value
  // (ingest stores it for text-only clips).
  const audioCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    SELECT
      id,
      agent_name,
      text_content,
      CASE WHEN created_at >= ${audioCutoff} THEN audio_url ELSE '' END AS audio_url,
      title,
      duration_seconds,
      category,
      voice_id,
      created_at
    FROM voice_samples
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as VoiceSample[];

  return json(rows);
};
