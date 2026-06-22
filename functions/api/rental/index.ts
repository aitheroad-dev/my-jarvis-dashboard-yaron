import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// Read-only mirror of the NL rental findings. The Hetzner box repopulates the
// `rental_listings` table on every scrape run (push-dashboard.ts); this endpoint
// just serves what's there. Reachable by admin (owner) and the move role (Noa) —
// `_middleware.ts` whitelists /api/rental for the move role.

type RentalRow = {
  id: string;
  source: string;
  url: string;
  title: string | null;
  city: string | null;
  property_type: string | null;
  rent_eur: number | null;
  bedrooms: number | null;
  rooms: number | null;
  area_m2: number | null;
  eur_per_m2: number | null;
  delta_pct: number | null;
  tracks: string | null;
  is_match: number;
  is_new: number;
  first_seen: string | null;
  last_seen: string | null;
  synced_at: string;
};

function parseTracks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

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
      SELECT id, source, url, title, city, property_type, rent_eur, bedrooms,
             rooms, area_m2, eur_per_m2, delta_pct, tracks, is_match, is_new,
             first_seen, last_seen, synced_at
        FROM rental_listings
       WHERE active = 1
       ORDER BY is_match DESC,
                CASE WHEN delta_pct IS NULL THEN 1 ELSE 0 END ASC,
                delta_pct ASC,
                rent_eur ASC
       LIMIT 1000
    `) as RentalRow[];

    const listings = rows.map((r) => ({
      id: r.id,
      source: r.source,
      url: r.url,
      title: r.title,
      city: r.city,
      property_type: r.property_type,
      rent_eur: r.rent_eur,
      bedrooms: r.bedrooms,
      rooms: r.rooms,
      area_m2: r.area_m2,
      eur_per_m2: r.eur_per_m2,
      delta_pct: r.delta_pct,
      tracks: parseTracks(r.tracks),
      is_match: r.is_match === 1,
      is_new: r.is_new === 1,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    }));

    const matches = listings.filter((l) => l.is_match);
    const summary = {
      total: listings.length,
      matches: matches.length,
      delft: matches.filter((l) => l.tracks.includes("delft")).length,
      value: matches.filter((l) => l.tracks.includes("value")).length,
      newMatches: matches.filter((l) => l.is_new).length,
      lastSync: rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), ""),
    };

    return json({ listings, summary });
  } catch (err) {
    return json(
      {
        error: "rental listings fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
