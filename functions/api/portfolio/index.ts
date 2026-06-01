import type { PagesFunction } from "@cloudflare/workers-types";
import { json, requireUser, type Env } from "../../_lib/auth";

// Portfolio API — v1 snapshot mirror of the local pai-portfolio CLI (source of
// truth is local SQLite). Served from an embedded snapshot so the dashboard has
// no DB dependency yet; when the Neon mirror is provisioned, swap SEED for a
// SELECT against portfolio_holdings (see sql/013_portfolio.sql).
//
// Base reporting currency: EUR. fx = value of 1 unit of `ccy` in EUR.

const FX: Record<string, number> = { EUR: 1, USD: 0.926, CAD: 0.671, SEK: 0.1002 };
const AS_OF = "2026-06-01";

type Seed = {
  ticker: string; name: string; exchange: string; currency: string;
  qty: number; price_native: number; cluster: string; flags?: string;
};

const SEED: Seed[] = [
  { ticker: "SLV",   name: "iShares Silver Trust",          exchange: "NYSE Arca",        currency: "USD", qty: 601,   price_native: 68.42,  cluster: "metals" },
  { ticker: "GLDG",  name: "GoldMining Inc",                exchange: "NYSE American",    currency: "USD", qty: 20000, price_native: 1.17,   cluster: "metals" },
  { ticker: "PPG",   name: "PPG Industries",                exchange: "NYSE",             currency: "USD", qty: 200,   price_native: 112.98, cluster: "industrial" },
  { ticker: "MBLY",  name: "Mobileye Global",               exchange: "Nasdaq",           currency: "USD", qty: 2100,  price_native: 10.47,  cluster: "auto-tech" },
  { ticker: "STEX",  name: "Streamex (ex-BioSig)",          exchange: "Nasdaq",           currency: "USD", qty: 9500,  price_native: 1.49,   cluster: "gold-rwa" },
  { ticker: "ODYS",  name: "Odysight.ai",                   exchange: "Nasdaq",           currency: "USD", qty: 2950,  price_native: 4.58,   cluster: "medtech",   flags: "price?" },
  { ticker: "TELIF", name: "Telescope Innovations",         exchange: "US OTCQB",         currency: "USD", qty: 30000, price_native: 0.45,   cluster: "chem-tech" },
  { ticker: "CRDL",  name: "Cardiol Therapeutics",          exchange: "Toronto (TSX)",    currency: "CAD", qty: 8000,  price_native: 1.69,   cluster: "biotech" },
  { ticker: "HELP",  name: "Helus Pharma (ex-Cybin)",       exchange: "Nasdaq",           currency: "USD", qty: 2000,  price_native: 4.41,   cluster: "biotech" },
  { ticker: "GARLF", name: "Roxmore Resources (ex-Axcap)",  exchange: "US OTCQX",         currency: "USD", qty: 3000,  price_native: 2.89,   cluster: "resources" },
  { ticker: "DEFI",  name: "DeFi Technologies",             exchange: "Cboe Canada",      currency: "CAD", qty: 11100, price_native: 0.94,   cluster: "crypto" },
  { ticker: "DETX",  name: "Liberty Defense (Nasdaq)",      exchange: "Nasdaq",           currency: "USD", qty: 1330,  price_native: 4.50,   cluster: "defense" },
  { ticker: "ARISE", name: "Arise AB",                      exchange: "Nasdaq Stockholm", currency: "SEK", qty: 1200,  price_native: 44.60,  cluster: "energy" },
  { ticker: "AETH",  name: "Bitwise Ethereum Strategy ETF", exchange: "NYSE Arca",        currency: "USD", qty: 86,    price_native: 32.60,  cluster: "crypto",    flags: "price?" },
  { ticker: "UUUFF", name: "Uranium One Mining",            exchange: "US OTC",           currency: "USD", qty: 8600,  price_native: 0.2892, cluster: "uranium",   flags: "ticker->UUUFD" },
  { ticker: "RBOHF", name: "Humanoid Global Holdings",      exchange: "US OTC",           currency: "USD", qty: 7000,  price_native: 0.2281, cluster: "robotics" },
  { ticker: "SCAN",  name: "Liberty Defense (TSX-V)",       exchange: "TSX Venture",      currency: "CAD", qty: 222,   price_native: 6.11,   cluster: "defense" },
];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const enriched = SEED.map((h) => {
    const rate = FX[h.currency] ?? 0;
    const value_base = h.qty * h.price_native * rate; // EUR
    return { ...h, value_base, value_usd: value_base / FX.USD };
  });

  const total_base = enriched.reduce((s, h) => s + h.value_base, 0);
  const holdings = enriched
    .map((h) => ({ ...h, weight: h.value_base / total_base }))
    .sort((a, b) => b.value_base - a.value_base);

  const byCcy: Record<string, number> = {};
  const byCluster: Record<string, number> = {};
  for (const h of enriched) {
    byCcy[h.currency] = (byCcy[h.currency] ?? 0) + h.value_base;
    byCluster[h.cluster] = (byCluster[h.cluster] ?? 0) + h.value_base;
  }
  const toRows = (m: Record<string, number>, key: "ccy" | "cluster") =>
    Object.entries(m)
      .map(([k, v]) => ({ [key]: k, value_base: v, pct: v / total_base }))
      .sort((a, b) => b.value_base - a.value_base);

  return json({
    base: "EUR",
    as_of: AS_OF,
    fx: FX,
    total_base,
    total_usd: total_base / FX.USD,
    total_cad: total_base / FX.CAD,
    positions: holdings.length,
    holdings,
    by_currency: toRows(byCcy, "ccy"),
    by_cluster: toRows(byCluster, "cluster"),
  });
};
