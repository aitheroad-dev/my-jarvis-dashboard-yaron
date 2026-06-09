import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type ContentRow = { content: string | null; updated_at: string };

/**
 * GET /api/kb/<slug...>
 *
 * Catchall route — matches arbitrary path depth so slugs containing forward
 * slashes (e.g. `kb-doc/mj-os/dashboard-architecture`) resolve to a
 * single page_content row. Returns `{ content, updated_at }`.
 *
 * Why catchall (`[[catchall]].ts`) and not `[slug].ts`: Cloudflare Pages
 * dynamic-segment routes match exactly one path segment. Our slug convention
 * uses slashes as a hierarchy separator inside the slug ITSELF, so we need
 * arbitrary depth in one parameter. The `params.catchall` value is a string
 * array of segments — we re-join with `/` to reconstruct the slug.
 */
export const onRequestGet: PagesFunction<Env, "catchall"> = async ({
  params,
  request,
  env,
}) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const raw = params.catchall;
  const slug = Array.isArray(raw) ? raw.join("/") : typeof raw === "string" ? raw : "";
  if (!slug) {
    return json({ error: "missing slug" }, { status: 400 });
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT content, updated_at
      FROM page_content
      WHERE page_slug = ${slug}
      LIMIT 1
    `) as ContentRow[];

    if (rows.length === 0) {
      return json({ error: "page not found", slug }, { status: 404 });
    }

    const content = rows[0].content ? JSON.parse(rows[0].content as string) : null;
    return json({ content, updated_at: rows[0].updated_at });
  } catch (err) {
    return json(
      {
        error: "kb fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
