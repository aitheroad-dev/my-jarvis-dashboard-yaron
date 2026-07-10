import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// Read-only mirror of the Advisor Corpus (How to Invest My Money project).
// The Mac-local pipeline pushes rows into the invest_* D1 tables; this endpoint
// only serves the current mirror. Payload is bounded: claims capped at 2000.

type InvestChannelRow = {
  id: string;
  name: string;
  handle: string;
  style: string | null;
  jurisdiction: string | null;
  on_roster: number;
  notes: string | null;
};

type InvestVideoRow = {
  id: string;
  channel_id: string;
  title: string;
  url: string;
  views: number | null;
  duration_s: number | null;
  upload_date: string | null;
  words: number | null;
  transcript_source: string | null;
  summary_md: string | null;
  claims_total: number;
  claims_validated: number;
  claims_quarantined: number;
  processed_at: string | null;
};

type InvestClaimRow = {
  id: number;
  video_id: string;
  claim: string;
  type: string;
  stance: string;
  quote: string | null;
  jurisdiction: string | null;
  validated: number;
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
    const channels = (await sql/* sql */ `
      SELECT id, name, handle, style, jurisdiction, on_roster, notes
      FROM invest_channels ORDER BY name ASC
    `) as unknown as InvestChannelRow[];

    const videos = (await sql/* sql */ `
      SELECT id, channel_id, title, url, views, duration_s, upload_date, words,
             transcript_source, summary_md, claims_total, claims_validated,
             claims_quarantined, processed_at
      FROM invest_videos ORDER BY upload_date DESC
    `) as unknown as InvestVideoRow[];

    const claims = (await sql/* sql */ `
      SELECT id, video_id, claim, type, stance, quote, jurisdiction, validated
      FROM invest_claims ORDER BY video_id ASC, id ASC LIMIT 2000
    `) as unknown as InvestClaimRow[];

    return json({ channels, videos, claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `invest query failed: ${message}` }, { status: 500 });
  }
};
