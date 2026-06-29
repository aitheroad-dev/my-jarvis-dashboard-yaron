import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

// Read-only mirror of the NL FOR-SALE value radar. Data comes from D1
// (`/api/koop`), repopulated nightly (02:00) by the Hetzner box: the top-200
// most-underpriced koop listings nationally by PEER-RELATIVE €/m² (each home vs
// comparable homes — same type, similar size, same locality). Fresh-listings
// radar (NL koop is ~110k listings; coverage accumulates).

type KoopDeal = {
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
};

type KoopSummary = {
  count: number;
  best: number | null;
  median: number | null;
  houses: number;
  apartments: number;
  cityTier: number;
  lastSync: string;
};

type KoopResponse = { deals: KoopDeal[]; summary: KoopSummary };

type TypeFilter = "all" | "house" | "apartment";
type TierFilter = "all" | "city" | "province";

function euro(v: number | null): string {
  if (v == null) return "—";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function perM2(v: number | null): string {
  if (v == null) return "—";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function deltaText(v: number | null): string {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(0) + "%";
}

function locationText(d: KoopDeal): string {
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

function TypeBadge({ d }: { d: KoopDeal }) {
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

const GRID = "44px minmax(180px, 2.2fr) minmax(130px, 1.2fr) 100px 70px 80px 90px 96px";

function DealRow({ d, isMobile }: { d: KoopDeal; isMobile: boolean }) {
  const title = d.title?.trim() || d.city || d.url;
  const strong = d.delta_pct != null && d.delta_pct <= -25;

  if (isMobile) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.white }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <a href={d.url} target="_blank" rel="noreferrer" style={{ color: T.ink, fontWeight: 700, fontSize: 14, lineHeight: 1.35, textDecoration: "none", wordBreak: "break-word" }}>
            {d.rank != null ? `#${d.rank} · ` : ""}{title}
          </a>
          <div style={{ fontWeight: 800, color: strong ? T.green : T.ink, whiteSpace: "nowrap" }}>{deltaText(d.delta_pct)}</div>
        </div>
        <div style={{ color: T.ink2, fontSize: 12, marginTop: 4 }}>
          {locationText(d)} · {euro(d.price_eur)} · {d.area_m2 != null ? `${Math.round(d.area_m2)} m²` : "—"} · {perM2(d.eur_per_m2)}/m²
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <TypeBadge d={d} />
          <span style={{ color: T.ink3, fontSize: 11, fontWeight: 700 }}>
            vs {perM2(d.peer_median_eur_per_m2)}/m² ({d.peer_tier}, n={d.peer_count ?? "—"})
          </span>
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
      <span style={{ color: T.ink2, fontSize: 13 }}>{d.area_m2 != null ? `${Math.round(d.area_m2)}m²` : "—"}</span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{perM2(d.eur_per_m2)}</span>
      <span style={{ color: strong ? T.green : T.ink2, fontSize: 13, fontWeight: strong ? 800 : 500 }} title={`vs local peer median ${perM2(d.peer_median_eur_per_m2)}/m² (${d.peer_tier}, n=${d.peer_count ?? "—"})`}>
        {deltaText(d.delta_pct)}
      </span>
      <TypeBadge d={d} />
    </div>
  );
}

export function KoopPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [data, setData] = useState<KoopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<TypeFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/koop");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as KoopResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deals");
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
    if (tier !== "all" && d.peer_tier !== tier) return false;
    return true;
  });
  const s = data?.summary;

  return (
    <div style={{ fontFamily: "Inter, Arial, sans-serif", boxSizing: "border-box", padding: isMobile ? "20px 14px 60px" : "36px 44px 80px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8 }}>NL FOR SALE</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>🔑 Value radar</h1>
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
            The 200 most <strong>underpriced</strong> for-sale homes in NL by <strong>€/m² vs local peers</strong> (same type, similar size, same city/province).
            Scraped from Funda nightly. A negative number = below its local market. Biggest discounts skew to cheaper regions + fixer-uppers; <strong>city-tier</strong> rows are underpriced even for their own city.
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
          <SummaryCard label="DEALS" value={s?.count ?? "—"} accent={T.ink} />
          <SummaryCard label="BEST" value={s?.best != null ? deltaText(s.best) : "—"} accent={T.green} />
          <SummaryCard label="MEDIAN" value={s?.median != null ? deltaText(s.median) : "—"} accent={T.skyDark} />
          <SummaryCard label="CITY-TIER" value={s?.cityTier ?? "—"} accent={T.amber} />
          <SummaryCard label="HOUSES" value={s?.houses ?? "—"} accent={T.ink3} />
          <SummaryCard label="APTS" value={s?.apartments ?? "—"} accent={T.ink3} />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <FilterChip label="All types" active={type === "all"} onClick={() => setType("all")} />
          <FilterChip label="Houses" active={type === "house"} onClick={() => setType("house")} />
          <FilterChip label="Apartments" active={type === "apartment"} onClick={() => setType("apartment")} />
          <span style={{ width: 1, height: 22, background: T.line, margin: "0 4px" }} />
          <FilterChip label="All tiers" active={tier === "all"} onClick={() => setTier("all")} />
          <FilterChip label="City" active={tier === "city"} onClick={() => setTier("city")} />
          <FilterChip label="Province" active={tier === "province"} onClick={() => setTier("province")} />
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>
        ) : null}

        {/* Deal list */}
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden" }}>
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "11px 18px", borderBottom: `1px solid ${T.line}`, background: T.bg2, fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: "0.03em" }}>
              <span>#</span>
              <span>LISTING</span>
              <span>LOCATION</span>
              <span>PRICE</span>
              <span>SIZE</span>
              <span>€/M²</span>
              <span>VS PEERS</span>
              <span>TYPE</span>
            </div>
          )}

          {data === null ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3 }}>No deals for this filter.</div>
          ) : (
            filtered.map((d) => <DealRow key={d.id} d={d} isMobile={isMobile} />)
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
          Showing {filtered.length} of {all.length} ranked deals · source: Funda koop via the box pipeline (nightly).
        </div>
      </div>
    </div>
  );
}

(KoopPage as unknown as { path: string }).path = "/koop";
