import type { PagesFunction } from "@cloudflare/workers-types";
import { requireUser, type Env } from "../../../_lib/auth";

/**
 * Serves the R2-stored Kokoro MP3 for a voice sample.
 *
 * The local pai-voice CLI base64s the rendered clip into POST /api/voice/ingest,
 * which stores the bytes in R2. The browser's <audio> element fetches this
 * same-origin endpoint, so the Cloudflare Access cookie rides along and
 * requireUser passes.
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

  const obj = await env.VOICE_BUCKET.get(`${id}.mp3`);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "audio/mpeg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
};
