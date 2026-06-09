export interface Env {
  /** Cloudflare D1 (SQLite) — the dashboard's data store. Replaces Neon. */
  DB: D1Database;
  /** Cloudflare R2 bucket holding voice-clip audio (replaces Postgres bytea). */
  VOICE_BUCKET: R2Bucket;
  /** Public base URL for the R2 voice bucket, e.g. https://pub-xxxx.r2.dev */
  VOICE_PUBLIC_URL: string;
  TENANT_OWNER_EMAIL: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export type AuthedUser = {
  userId: string;
  sessionId: string | null;
  orgId: string;
};

/**
 * Trusts Cloudflare Access: every request must arrive through the Access
 * policy, which sets Cf-Access-Authenticated-User-Email after sign-in.
 * The function rejects if the header is missing or doesn't match the
 * single allow-listed email (TENANT_OWNER_EMAIL).
 *
 * The Access policy is the primary security boundary; this header check is
 * defense-in-depth so direct-to-origin requests still fail closed.
 */
export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthedUser> {
  const email = request.headers
    .get("Cf-Access-Authenticated-User-Email")
    ?.toLowerCase();

  if (!email) {
    throw unauthorized("missing Cf-Access-Authenticated-User-Email header");
  }

  const expected = env.TENANT_OWNER_EMAIL?.toLowerCase();
  if (!expected) {
    throw unauthorized("server misconfigured: TENANT_OWNER_EMAIL not set");
  }

  if (email !== expected) {
    throw unauthorized(`email ${email} not authorized for this dashboard`);
  }

  return {
    userId: email,
    sessionId: request.headers.get("Cf-Access-Jwt-Assertion"),
    orgId: "single-tenant",
  };
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
