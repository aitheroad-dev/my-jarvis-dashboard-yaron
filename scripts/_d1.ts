/**
 * D1 REST tagged-template for local scripts (seeding). Mirrors the Worker
 * shim in functions/_lib/db.ts, but talks to the D1 HTTP API so a local bun
 * process can write to the same database the dashboard Functions read.
 *
 * Env: CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN.
 *
 *   const sql = getD1Sql();
 *   const rows = await sql`INSERT INTO projects (...) VALUES (${a}) RETURNING id`;
 */
type D1Bind = string | number | null;

function normalizeBind(v: unknown): D1Bind {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v as D1Bind;
}

export function getD1Sql() {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!acct || !dbId || !token) {
    throw new Error(
      "Missing D1 credentials — set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN",
    );
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`;

  return async function sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    let query = strings[0];
    const params: D1Bind[] = [];
    for (let i = 0; i < values.length; i++) {
      query += "?" + strings[i + 1];
      params.push(normalizeBind(values[i]));
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sql: query, params }),
        });
        const body = (await res.json()) as {
          success: boolean;
          errors?: unknown;
          result?: Array<{ results?: T[] }>;
        };
        if (!body.success) {
          throw new Error("D1 query failed: " + JSON.stringify(body.errors));
        }
        return body.result?.[0]?.results ?? [];
      } catch (e) {
        lastErr = e;
        if (attempt === 2) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}
