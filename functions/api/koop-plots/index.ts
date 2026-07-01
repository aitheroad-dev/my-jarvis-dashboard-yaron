import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

// Read-only mirror of the NL FOR-SALE large-plots radar. The Hetzner box
// repopulates `koop_plots` on every nightly run (push-plots-dashboard.ts) with
// koop listings whose PLOT (land) area is ≥1,000 m², ranked by the cheapest
// €/m² of plot (price ÷ plot size — best land value first). Owner-only page.

type PlotRow = {
  id: string;
  rank: number | null;
  url: string;
  title: string | null;
  city: string | null;
  province: string | null;
  postcode: string | null;
  price_eur: number | null;
  plot_m2: number | null;
  living_m2: number | null;
  eur_per_plot_m2: number | null;
  property_type: string | null;
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
      SELECT id, rank, url, title, city, province, postcode, price_eur, plot_m2,
             living_m2, eur_per_plot_m2, property_type, synced_at
        FROM koop_plots
       ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END ASC, rank ASC, eur_per_plot_m2 ASC
       LIMIT 500
    `) as PlotRow[];

    const deals = rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      url: r.url,
      title: r.title,
      city: r.city,
      province: r.province,
      postcode: r.postcode,
      price_eur: r.price_eur,
      plot_m2: r.plot_m2,
      living_m2: r.living_m2,
      eur_per_plot_m2: r.eur_per_plot_m2,
      property_type: r.property_type,
    }));

    const prices = deals
      .map((d) => d.eur_per_plot_m2)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    const plots = deals
      .map((d) => d.plot_m2)
      .filter((v): v is number => v != null);

    const summary = {
      count: deals.length,
      cheapest: prices.length ? prices[0] : null,
      median,
      biggestPlot: plots.length ? Math.max(...plots) : null,
      houses: deals.filter((d) => d.property_type === "house").length,
      apartments: deals.filter((d) => d.property_type === "apartment").length,
      lastSync: rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), ""),
    };

    return json({ deals, summary });
  } catch (err) {
    return json(
      {
        error: "koop plots fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
