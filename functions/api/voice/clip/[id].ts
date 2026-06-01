import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { requireUser, type Env } from "../../../_lib/auth";

/**
 * Serves the inline-stored Kokoro MP3 for a voice sample.
 *
 * The local pai-voice CLI base64s the rendered clip into POST /api/voice/ingest,
 * which stores the bytes in voice_samples.audio_data and points audio_url at
 * this endpoint. The browser's <audio> element fetches it same-origin, so the
 * Cloudflare Access cookie rides along and requireUser passes.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const id = String(params.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("bad id", { status: 400 });
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */`
    SELECT encode(audio_data, 'base64') AS b64, audio_mime
    FROM voice_samples
    WHERE id = ${id} AND audio_data IS NOT NULL
    LIMIT 1
  `) as { b64: string | null; audio_mime: string | null }[];

  if (!rows.length || !rows[0].b64) {
    return new Response("not found", { status: 404 });
  }

  const bytes = Uint8Array.from(atob(rows[0].b64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": rows[0].audio_mime || "audio/mpeg",
      "content-length": String(bytes.length),
      // Clip bytes are immutable once written; let the browser cache hard.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
};
