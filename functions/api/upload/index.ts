import type { PagesFunction, R2Bucket } from "@cloudflare/workers-types";
import { json, type Env as AuthEnv } from "../../_lib/auth";

interface Env extends AuthEnv {
  VOICE_API_KEY: string;
  VOICE_BUCKET: R2Bucket;
}

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 5_000_000;
const MAX_BASE64_LEN = 6_700_000;
const MAX_FILENAME_LEN = 64;
const FILENAME_STRIP_RE = /[^A-Za-z0-9._-]/g;

const MAGIC_BYTES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": (b) =>
    b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) =>
    b.length >= 4 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  "image/webp": (b) =>
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !env.VOICE_API_KEY || match[1] !== env.VOICE_API_KEY) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { filename?: unknown; contentBase64?: unknown; contentType?: unknown; prefix?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const rawFilename = typeof body.filename === "string" ? body.filename : "";
  const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const prefix = typeof body.prefix === "string" && body.prefix.length > 0 ? body.prefix : "assets/";

  if (!rawFilename) return json({ error: "filename_required" }, { status: 400 });
  if (!contentBase64) return json({ error: "empty_content" }, { status: 400 });
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ error: "invalid_content_type", got: contentType }, { status: 400 });
  }
  if (!/^[A-Za-z0-9/_-]+$/.test(prefix) || !prefix.endsWith("/")) {
    return json({ error: "invalid_prefix" }, { status: 400 });
  }

  if (contentBase64.length > MAX_BASE64_LEN) {
    return json(
      { error: "file_too_large", limit_bytes: MAX_BYTES, encoded_len: contentBase64.length },
      { status: 413 },
    );
  }

  const sanitizedFilename = rawFilename
    .replace(FILENAME_STRIP_RE, "")
    .slice(0, MAX_FILENAME_LEN);
  if (!sanitizedFilename) {
    return json({ error: "invalid_filename", got: rawFilename }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: "invalid_base64" }, { status: 400 });
  }

  if (bytes.length > MAX_BYTES) {
    return json(
      { error: "file_too_large", limit_bytes: MAX_BYTES, actual_bytes: bytes.length },
      { status: 413 },
    );
  }

  const verify = MAGIC_BYTES[contentType];
  if (!verify || !verify(bytes)) {
    return json({ error: "invalid_magic_bytes", contentType }, { status: 400 });
  }

  const key = `${prefix}${crypto.randomUUID()}-${sanitizedFilename}`;

  try {
    await env.VOICE_BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch (err) {
    return json(
      {
        error: "r2_put_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const publicBase = env.VOICE_PUBLIC_URL?.replace(/\/$/, "") ?? "";
  if (!publicBase) {
    return json({ error: "missing_public_url_var" }, { status: 500 });
  }

  return json({
    url: `${publicBase}/${key}`,
    key,
    size: bytes.length,
    contentType,
  });
};
