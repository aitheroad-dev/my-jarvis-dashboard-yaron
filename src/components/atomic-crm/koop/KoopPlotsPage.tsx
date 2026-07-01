import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

// Read-only mirror of the NL FOR-SALE large-plots radar. Data comes from D1
// (`/api/koop-plots`), repopulated nightly (02:00) by the Hetzner box: koop
// listings whose PLOT (land) area is ≥1,000 m², ranked by the CHEAPEST €/m² of
// plot (asking price ÷ plot size = best land value first). Plot size is parsed
// from each Funda card's raw text. Sibling of KoopPage (the value radar).

type PlotDeal = {
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
};

type PlotSummary = {
  count: number;
  cheapest: number | null;
  median: number | null;
  biggestPlot: number | null;
  houses: number;
  apartments: number;
  lastSync: string;
};

type PlotResponse = { deals: PlotDeal[]; summary: PlotSummary };

type TypeFilter = "all" | "house" | "apartment";

function euro(v: number | null): string {
  if (v == null) return "—";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function perM2(v: number | null): string {
  if (v == null) return "—";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function area(v: number | null): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("nl-NL") + " m²";
}

function locationText(d: PlotDeal): string {
  const city = d.city ? d.city.replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
  return d.province ? `${city} · ${d.province.replace(/-/g, " ")}` : city;
}

function lastSyncText(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("nl-NL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Badge({ text, fg, bg, bd }: { text: string; fg: string; bg: string; bd: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        color: fg,
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        textTransform: "capitalize",
      }}
    >
      {text}
    </span>
  );
}

function TypeBadge({ d }: { d: PlotDeal }) {
  if (d.property_type === "apartment") return <Badge text="Apartment" fg={T.skyDark} bg={T.skySoft} bd={T.sky} />;
  if (d.property_type === "house") return <Badge text="House" fg={T.green} bg={T.greenSoft} bd={T.green} />;
  return <Badge text={d.property_type ?? "—"} fg={T.ink3} bg={T.bg2} bd={T.line} />;
}

function SummaryCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 92, border: `1px solid ${T.line}`, borderRadius: 10, background: T.white, padding: "14px 16px" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginTop: 4, letterSpacing: "0.02em" }}>{label}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? T.skyDark : T.line}`,
        background: active ? T.skySoft : T.white,
        color: active ? T.skyDark : T.ink2,
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

const GRID = "44px minmax(170px, 2.1fr) minmax(120px, 1.1fr) 104px 96px 84px 84px 96px";

type SortKey = "rank" | "listing" | "location" | "price" | "plot" | "eur_per_plot_m2" | "living" | "type";
type SortDir = "asc" | "desc";

// Header columns in grid order. Every column is click-to-sort.
const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: "rank", label: "#" },
  { key: "listing", label: "LISTING" },
  { key: "location", label: "LOCATION" },
  { key: "price", label: "PRICE" },
  { key: "plot", label: "PLOT" },
  { key: "eur_per_plot_m2", label: "€/M²" },
  { key: "living", label: "LIVING" },
  { key: "type", label: "TYPE" },
];

function sortValue(d: PlotDeal, key: SortKey): number | string | null {
  switch (key) {
    case "rank": return d.rank;
    case "listing": return (d.title?.trim() || d.city || d.url || "").toLowerCase();
    case "location": return locationText(d).toLowerCase();
    case "price": return d.price_eur;
    case "plot": return d.plot_m2;
    case "eur_per_plot_m2": return d.eur_per_plot_m2;
    case "living": return d.living_m2;
    case "type": return d.property_type;
  }
}

// Stable sort; missing values (null / NaN) always sink to the bottom regardless of direction.
function sortDeals(deals: PlotDeal[], key: SortKey, dir: SortDir): PlotDeal[] {
  return [...deals].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aNull = av == null || (typeof av === "number" && Number.isNaN(av));
    const bNull = bv == null || (typeof bv === "number" && Number.isNaN(bv));
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "nl-NL");
    return dir === "asc" ? cmp : -cmp;
  });
}

function DealRow({ d, isMobile }: { d: PlotDeal; isMobile: boolean }) {
  const title = d.title?.trim() || d.city || d.url;

  if (isMobile) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.white }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <a href={d.url} target="_blank" rel="noreferrer" style={{ color: T.ink, fontWeight: 700, fontSize: 14, lineHeight: 1.35, textDecoration: "none", wordBreak: "break-word" }}>
            {d.rank != null ? `#${d.rank} · ` : ""}{title}
          </a>
          <div style={{ fontWeight: 800, color: T.green, whiteSpace: "nowrap" }}>{perM2(d.eur_per_plot_m2)}/m²</div>
        </div>
        <div style={{ color: T.ink2, fontSize: 12, marginTop: 4 }}>
          {locationText(d)} · {euro(d.price_eur)} · plot {area(d.plot_m2)} · living {area(d.living_m2)}
        </div>
        <div style={{ marginTop: 8 }}>
          <TypeBadge d={d} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${T.line}`, background: T.white }}>
      <span style={{ color: T.ink3, fontSize: 13, fontWeight: 700 }}>{d.rank != null ? `#${d.rank}` : "—"}</span>
      <a href={d.url} target="_blank" rel="noreferrer" style={{ color: T.ink, fontWeight: 700, fontSize: 13.5, textDecoration: "none", wordBreak: "break-word" }}>
        {title}
      </a>
      <span style={{ color: T.ink2, fontSize: 13 }}>{locationText(d)}</span>
      <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{euro(d.price_eur)}</span>
      <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{area(d.plot_m2)}</span>
      <span style={{ color: T.green, fontSize: 13, fontWeight: 800 }} title="asking price ÷ plot size">{perM2(d.eur_per_plot_m2)}</span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{area(d.living_m2)}</span>
      <TypeBadge d={d} />
    </div>
  );
}

export function KoopPlotsPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [data, setData] = useState<PlotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("eur_per_plot_m2");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/koop-plots");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PlotResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plots");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = data?.deals ?? [];
  const filtered = all.filter((d) => {
    if (type !== "all" && d.property_type !== type) return false;
    return true;
  });
  const sorted = sortDeals(filtered, sortKey, sortDir);
  const s = data?.summary;

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif", boxSizing: "border-box", padding: isMobile ? "20px 14px 60px" : "36px 44px 80px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8 }}>NL FOR SALE</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>🌳 Large plots</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: T.ink3, fontWeight: 600 }}>Updated {s ? lastSyncText(s.lastSync) : "—"}</span>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh"
                title="Refresh"
                style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.line}`, background: T.white, color: T.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: loading ? "default" : "pointer" }}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
          <p style={{ fontSize: isMobile ? 14 : 15, color: T.ink2, lineHeight: 1.6, margin: "10px 0 0", maxWidth: 820 }}>
            For-sale homes on a <strong>large plot</strong> (≥1,000 m² of land), ranked by the <strong>cheapest €/m² of plot</strong> (asking price ÷ plot size).
            Plot size is read from each Funda card. Lowest €/m² = best land value — these skew to rural regions where land is cheap.
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
          <SummaryCard label="PLOTS" value={s?.count ?? "—"} accent={T.ink} />
          <SummaryCard label="CHEAPEST €/M²" value={s?.cheapest != null ? perM2(s.cheapest) : "—"} accent={T.green} />
          <SummaryCard label="MEDIAN €/M²" value={s?.median != null ? perM2(s.median) : "—"} accent={T.skyDark} />
          <SummaryCard label="BIGGEST PLOT" value={s?.biggestPlot != null ? area(s.biggestPlot) : "—"} accent={T.amber} />
          <SummaryCard label="HOUSES" value={s?.houses ?? "—"} accent={T.ink3} />
          <SummaryCard label="APTS" value={s?.apartments ?? "—"} accent={T.ink3} />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <FilterChip label="All types" active={type === "all"} onClick={() => setType("all")} />
          <FilterChip label="Houses" active={type === "house"} onClick={() => setType("house")} />
          <FilterChip label="Apartments" active={type === "apartment"} onClick={() => setType("apartment")} />
          {isMobile && (
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, dir] = e.target.value.split(":");
                setSortKey(k as SortKey);
                setSortDir(dir as SortDir);
              }}
              aria-label="Sort plots"
              style={{ marginLeft: "auto", border: `1px solid ${T.line}`, background: T.white, color: T.ink2, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              <option value="eur_per_plot_m2:asc">€/m² ↑ (cheapest)</option>
              <option value="eur_per_plot_m2:desc">€/m² ↓</option>
              <option value="plot:desc">Plot ↓ (biggest)</option>
              <option value="plot:asc">Plot ↑</option>
              <option value="price:asc">Price ↑</option>
              <option value="price:desc">Price ↓</option>
              <option value="living:desc">Living ↓</option>
              <option value="location:asc">Location A–Z</option>
            </select>
          )}
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>
        ) : null}

        {/* Deal list */}
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden" }}>
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "11px 18px", borderBottom: `1px solid ${T.line}`, background: T.bg2 }}>
              {SORT_COLS.map((col) => {
                const activeCol = sortKey === col.key;
                return (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => onSort(col.key)}
                    title={`Sort by ${col.label === "#" ? "rank" : col.label.toLowerCase()}`}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                      color: activeCol ? T.skyDark : T.ink3,
                      userSelect: "none",
                    }}
                  >
                    {col.label}
                    <span style={{ fontSize: 9, lineHeight: 1, opacity: activeCol ? 1 : 0.3 }}>
                      {activeCol ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {data === null ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading…
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3 }}>No large plots for this filter.</div>
          ) : (
            sorted.map((d) => <DealRow key={d.id} d={d} isMobile={isMobile} />)
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
          Showing {sorted.length} of {all.length} large-plot listings · plot ≥ 1,000 m² · source: Funda koop via the box pipeline (nightly).
        </div>
      </div>
    </div>
  );
}

(KoopPlotsPage as unknown as { path: string }).path = "/koop-plots";
