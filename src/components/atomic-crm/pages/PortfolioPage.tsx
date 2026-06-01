// PortfolioPage.tsx — Portfolio domain (Structured).
//
// Visual mirror of the local-first pai-portfolio CLI (source of truth = local
// SQLite). v1 is a currency-normalized SNAPSHOT: holdings, allocation, currency
// exposure, concentration. Performance / realized-unrealized P&L are stubbed
// until cost basis lands. Data via GET /api/portfolio (base currency EUR).

import { useEffect, useState } from "react";
import { Loader2, PieChart } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import { SortableTable, type ColumnDef } from "../blueprint/SortableTable";

type Holding = {
  ticker: string; name: string; exchange: string; currency: string;
  qty: number; price_native: number; cluster: string; flags?: string | null;
  value_base: number; value_usd: number; weight: number;
};
type PortfolioData = {
  base: string; as_of: string;
  total_base: number; total_usd: number; total_cad: number; positions: number;
  holdings: Holding[];
  by_currency: { ccy: string; value_base: number; pct: number }[];
  by_cluster: { cluster: string; value_base: number; pct: number }[];
};

const SLICE = [T.skyDark, T.green, T.amber, T.accent, T.sky, "#8B5CF6", T.ink3];
const CCY_COLOR: Record<string, string> = { USD: T.skyDark, CAD: T.amber, SEK: T.green, EUR: T.accent };

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-US");
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct1 = (n: number) => (n * 100).toFixed(1) + "%";
const prettyCluster = (c: string) =>
  c.replace(/-/g, "/").replace(/\b\w/g, (m) => m.toUpperCase());

function Donut({ slices }: { slices: { label: string; pct: number; color: string }[] }) {
  const size = 168, stroke = 28, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((s, i) => {
          const len = s.pct * circ;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      flex: "1 1 150px", minWidth: 150, background: T.white,
      border: `1px solid ${T.line}`, borderRadius: 12, padding: "16px 18px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.skyDark, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: T.ink, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BarRow({ label, pct, value, color }: { label: string; pct: number; value: string; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.ink2, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: T.ink }}>{label}</span>
        <span>{pct1(pct)} · {value}</span>
      </div>
      <div style={{ height: 8, background: T.bg2, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(1, pct * 100)}%`, height: "100%", background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      flex: "1 1 300px", minWidth: 280, background: T.white,
      border: `1px solid ${T.line}`, borderRadius: 12, padding: "20px 22px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

function Stub({ title }: { title: string }) {
  return (
    <div style={{
      flex: "1 1 240px", minWidth: 240, background: T.bg2,
      border: `1px dashed ${T.line}`, borderRadius: 12, padding: "20px 22px",
      display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 96,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink2, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: T.ink3 }}>Pending cost basis — add buy prices to unlock.</div>
    </div>
  );
}

const COLUMNS: ColumnDef<Holding>[] = [
  {
    key: "ticker", label: "Ticker", width: "92px",
    render: (h) => (
      <code style={{ background: T.skySoft, color: T.accent, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, padding: "2px 8px", borderRadius: 4 }}>{h.ticker}</code>
    ),
  },
  {
    key: "name", label: "Name",
    render: (h) => (
      <div>
        <div style={{ color: T.ink, fontWeight: 600 }}>{h.name}</div>
        <div style={{ color: T.ink3, fontSize: 11 }}>{h.exchange}</div>
      </div>
    ),
  },
  { key: "currency", label: "Ccy", width: "60px", render: (h) => <span style={{ color: T.ink2 }}>{h.currency}</span> },
  { key: "qty", label: "Qty", width: "90px", sortValue: (h) => h.qty, render: (h) => <span style={{ color: T.ink2 }}>{h.qty.toLocaleString("en-US")}</span> },
  { key: "price_native", label: "Price", width: "90px", sortValue: (h) => h.price_native, render: (h) => <span style={{ color: T.ink2 }}>{h.price_native}</span> },
  { key: "value_base", label: "Value (€)", width: "110px", sortValue: (h) => h.value_base, render: (h) => <span style={{ color: T.ink, fontWeight: 700 }}>{eur(h.value_base)}</span> },
  { key: "weight", label: "Weight", width: "80px", sortValue: (h) => h.weight, render: (h) => <span style={{ color: T.ink2 }}>{pct1(h.weight)}</span> },
  { key: "cluster", label: "Cluster", width: "110px", render: (h) => <span style={{ color: T.ink2 }}>{prettyCluster(h.cluster)}</span> },
  {
    key: "flags", label: "", width: "70px", sortable: false,
    render: (h) => h.flags ? (
      <span title={h.flags} style={{ fontSize: 10, fontWeight: 700, color: T.amber, background: T.amberSoft, border: `1px solid ${T.amber}`, padding: "2px 6px", borderRadius: 999 }}>⚠</span>
    ) : null,
  },
];

export function PortfolioPage() {
  const api = useApi();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/portfolio");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as PortfolioData;
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metalsPct = data
    ? data.by_cluster.filter((c) => ["metals", "gold-rwa", "resources", "uranium"].includes(c.cluster)).reduce((s, c) => s + c.pct, 0)
    : 0;
  const top = data?.holdings[0];

  // cluster donut: top 6 + Other
  const clusterSlices = (() => {
    if (!data) return [];
    const top6 = data.by_cluster.slice(0, 6);
    const restPct = data.by_cluster.slice(6).reduce((s, c) => s + c.pct, 0);
    const slices = top6.map((c, i) => ({ label: prettyCluster(c.cluster), pct: c.pct, color: SLICE[i % SLICE.length] }));
    if (restPct > 0) slices.push({ label: "Other", pct: restPct, color: T.ink3 });
    return slices;
  })();

  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "40px 48px 80px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "8px 20px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, textTransform: "uppercase", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PieChart style={{ width: 14, height: 14 }} /> MyJarvis · Wealth
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: T.ink, margin: "0 0 12px", letterSpacing: "-0.02em" }}>Portfolio</h1>
          <p style={{ fontSize: 15, color: T.ink2, lineHeight: 1.6, maxWidth: 680, margin: "0 auto" }}>
            Currency-normalized view of all holdings. Mirror of the local pai-portfolio ledger (source of truth on your machine).
          </p>
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13 }}>
            Failed to load portfolio: {error}
          </div>
        ) : data === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading…
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", marginBottom: 20 }}>
              Snapshot {data.as_of} · base {data.base} · cost basis &amp; performance pending
            </div>

            {/* KPI cards */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
              <Card label="Total (EUR)" value={eur(data.total_base)} sub={`≈ ${usd(data.total_usd)} · C$${Math.round(data.total_cad).toLocaleString("en-US")}`} />
              <Card label="Positions" value={String(data.positions)} />
              <Card label="Hard assets" value={pct1(metalsPct)} sub="metals · gold-RWA · mining" />
              <Card label="Top position" value={top ? top.ticker : "—"} sub={top ? `${pct1(top.weight)} · ${eur(top.value_base)}` : ""} />
            </div>

            {/* allocation + currency + concentration */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
              <Panel title="Allocation by cluster">
                <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                  <Donut slices={clusterSlices} />
                  <div style={{ flex: "1 1 140px", minWidth: 140 }}>
                    {clusterSlices.map((s, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 6, color: T.ink2 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{s.label}</span>
                        <span style={{ fontWeight: 600, color: T.ink }}>{pct1(s.pct)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel title="Currency exposure (in €)">
                {data.by_currency.map((c) => (
                  <BarRow key={c.ccy} label={c.ccy} pct={c.pct} value={eur(c.value_base)} color={CCY_COLOR[c.ccy] ?? T.skyDark} />
                ))}
              </Panel>

              <Panel title="Top positions by weight">
                {data.holdings.slice(0, 6).map((h, i) => (
                  <BarRow key={h.ticker} label={h.ticker} pct={h.weight} value={eur(h.value_base)} color={SLICE[i % SLICE.length]} />
                ))}
              </Panel>
            </div>

            {/* stubs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
              <Stub title="Performance over time" />
              <Stub title="Realized vs unrealized P&L" />
              <Stub title="Dividend income" />
            </div>

            {/* holdings table */}
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 12 }}>Holdings</div>
            <SortableTable
              rows={data.holdings}
              columns={COLUMNS}
              detailHref={() => "/portfolio"}
              rowKey={(h) => h.ticker}
              defaultSort={{ key: "value_base", dir: "desc" }}
              emptyMessage="No holdings yet."
            />
          </>
        )}
      </div>
    </div>
  );
}

(PortfolioPage as unknown as { path: string }).path = "/portfolio";
