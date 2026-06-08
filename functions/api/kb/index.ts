import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type ListRow = {
  page_slug: string;
  title: string | null;
  updated_at: string;
};

/**
 * GET /api/kb
 *
 * Returns a flat list of page_content rows for the KB index page.
 * Each item: { page_slug, title, updated_at } where title is extracted from
 * the content jsonb (`content->>'title'`). Sorted alphabetically by slug.
 *
 * Mirrors the lilach dashboard's /api/kb pattern. The dashboard's
 * BlockRenderer doctrine (MJOS-028) uses this as the fetch path for
 * /dashboard-architecture and /max-security-eyal-pitch-deck — content rows
 * are { blocks: [...] } payloads served verbatim through this endpoint.
 */
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
      ? 500
      : Math.min(limitParsed, 1000);

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT
        page_slug,
        content->>'title' AS title,
        updated_at
      FROM page_content
      ORDER BY page_slug ASC
      LIMIT ${limit}
    `) as ListRow[];

    return json(
      rows.map((r) => ({
        page_slug: r.page_slug,
        title: r.title ?? r.page_slug,
        updated_at: r.updated_at,
      })),
    );
  } catch (err) {
    return json(
      {
        error: "kb list failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
