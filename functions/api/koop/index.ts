import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// Read-only mirror of the NL FOR-SALE value radar. The Hetzner box repopulates
// `koop_listings` on every nightly run (push-koop-dashboard.ts) with the top-200
// most-underpriced koop listings by peer-relative €/m². Owner-only page.

type KoopRow = {
  id: string;
  rank: number | null;
  url: string;
  title: string | null;
  city: string | null;
  province: string | null;
  postcode: string | null;
  price_eur: number | null;
  area_m2: number | null;
  eur_per_m2: number | null;
  property_type: string | null;
  peer_tier: string | null;
  peer_count: number | null;
  peer_median_eur_per_m2: number | null;
  delta_pct: number | null;
  synced_at: string;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT id, rank, url, title, city, province, postcode, price_eur, area_m2,
             eur_per_m2, property_type, peer_tier, peer_count,
             peer_median_eur_per_m2, delta_pct, synced_at
        FROM koop_listings
       ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END ASC, rank ASC, delta_pct ASC
       LIMIT 500
    `) as KoopRow[];

    const deals = rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      url: r.url,
      title: r.title,
      city: r.city,
      province: r.province,
      postcode: r.postcode,
      price_eur: r.price_eur,
      area_m2: r.area_m2,
      eur_per_m2: r.eur_per_m2,
      property_type: r.property_type,
      peer_tier: r.peer_tier,
      peer_count: r.peer_count,
      peer_median_eur_per_m2: r.peer_median_eur_per_m2,
      delta_pct: r.delta_pct,
    }));

    const deltas = deals
      .map((d) => d.delta_pct)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;

    const summary = {
      count: deals.length,
      best: deltas.length ? deltas[0] : null,
      median,
      houses: deals.filter((d) => d.property_type === "house").length,
      apartments: deals.filter((d) => d.property_type === "apartment").length,
      cityTier: deals.filter((d) => d.peer_tier === "city").length,
      lastSync: rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), ""),
    };

    return json({ deals, summary });
  } catch (err) {
    return json(
      {
        error: "koop listings fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
