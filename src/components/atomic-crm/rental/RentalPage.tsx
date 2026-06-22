import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, MapPin, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

// Read-only mirror of the NL rental search. Data comes from D1 (`/api/rental`),
// repopulated by the Hetzner box on every scrape run (07:00 + 18:00). The map is
// the existing standalone site, embedded — it redeploys daily from the same box,
// so it stays fresh on its own.

const MAP_URL = "https://nl-rental-map.pages.dev";

type RentalListing = {
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
  tracks: string[];
  is_match: boolean;
  is_new: boolean;
  first_seen: string | null;
  last_seen: string | null;
};

type RentalSummary = {
  total: number;
  matches: number;
  delft: number;
  value: number;
  newMatches: number;
  lastSync: string;
};

type RentalResponse = { listings: RentalListing[]; summary: RentalSummary };

type ViewMode = "matches" | "all";
type TrackFilter = "all" | "delft" | "value";

function euro(v: number | null): string {
  if (v == null) return "—";
  return "€" + Math.round(v).toLocaleString("nl-NL");
}

function perM2(v: number | null): string {
  if (v == null) return "—";
  return "€" + v.toFixed(1);
}

function deltaText(v: number | null): string {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(0) + "%";
}

function sizeText(l: RentalListing): string {
  const bits: string[] = [];
  if (l.bedrooms != null) bits.push(`${l.bedrooms} bd`);
  if (l.rooms != null) bits.push(`${l.rooms} rm`);
  if (l.area_m2 != null) bits.push(`${Math.round(l.area_m2)} m²`);
  return bits.length ? bits.join(" · ") : "—";
}

function lastSyncText(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      }}
    >
      {text}
    </span>
  );
}

function TrackBadges({ l }: { l: RentalListing }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {l.tracks.includes("delft") && (
        <Badge text="Delft" fg={T.skyDark} bg={T.skySoft} bd={T.sky} />
      )}
      {l.tracks.includes("value") && (
        <Badge text="Value" fg={T.green} bg={T.greenSoft} bd={T.green} />
      )}
      {l.is_new && <Badge text="NEW" fg={T.amber} bg={T.amberSoft} bd={T.amber} />}
    </span>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 92,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        background: T.white,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginTop: 4, letterSpacing: "0.02em" }}>
        {label}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
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

function ListingRow({ l, isMobile }: { l: RentalListing; isMobile: boolean }) {
  const title = l.title?.trim() || l.city || l.url;

  if (isMobile) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.line}`, background: T.white }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: T.ink, fontWeight: 700, fontSize: 14, lineHeight: 1.35, textDecoration: "none", wordBreak: "break-word" }}
          >
            {title}
          </a>
          <div style={{ fontWeight: 800, color: T.ink, whiteSpace: "nowrap" }}>{euro(l.rent_eur)}</div>
        </div>
        <div style={{ color: T.ink2, fontSize: 12, marginTop: 4 }}>
          {l.city ?? "—"} · {sizeText(l)} · {perM2(l.eur_per_m2)}/m²
          {l.delta_pct != null ? ` · ${deltaText(l.delta_pct)} vs peers` : ""}
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <TrackBadges l={l} />
          <span style={{ color: T.ink3, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{l.source}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(200px, 2.2fr) minmax(90px, 0.9fr) 90px 80px 90px minmax(120px, 1fr) 80px",
        gap: 12,
        alignItems: "center",
        padding: "12px 18px",
        borderBottom: `1px solid ${T.line}`,
        background: T.white,
      }}
    >
      <a
        href={l.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: T.ink, fontWeight: 700, fontSize: 13.5, textDecoration: "none", wordBreak: "break-word" }}
      >
        {title}
      </a>
      <span style={{ color: T.ink2, fontSize: 13 }}>{l.city ?? "—"}</span>
      <span style={{ color: T.ink, fontSize: 13, fontWeight: 700 }}>{euro(l.rent_eur)}</span>
      <span style={{ color: T.ink2, fontSize: 13 }}>{perM2(l.eur_per_m2)}</span>
      <span style={{ color: l.delta_pct != null && l.delta_pct <= -15 ? T.green : T.ink2, fontSize: 13, fontWeight: l.delta_pct != null && l.delta_pct <= -15 ? 700 : 500 }}>
        {deltaText(l.delta_pct)}
      </span>
      <TrackBadges l={l} />
      <span style={{ color: T.ink3, fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>{l.source}</span>
    </div>
  );
}

export function RentalPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [data, setData] = useState<RentalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewMode>("matches");
  const [track, setTrack] = useState<TrackFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/rental");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RentalResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rentals");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = data?.listings ?? [];
  const filtered = all.filter((l) => {
    if (view === "matches" && !l.is_match) return false;
    if (track === "delft" && !l.tracks.includes("delft")) return false;
    if (track === "value" && !l.tracks.includes("value")) return false;
    return true;
  });

  const s = data?.summary;

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box",
        padding: isMobile ? "20px 14px 60px" : "36px 44px 80px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8 }}>
            NL HOUSE RENTAL
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>
              🏠 Rental search
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: T.ink3, fontWeight: 600 }}>
                Updated {s ? lastSyncText(s.lastSync) : "—"}
              </span>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh"
                title="Refresh"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: `1px solid ${T.line}`,
                  background: T.white,
                  color: T.ink2,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: loading ? "default" : "pointer",
                }}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
          <p style={{ fontSize: isMobile ? 14 : 15, color: T.ink2, lineHeight: 1.6, margin: "10px 0 0", maxWidth: 760 }}>
            Two tracks: <strong>Delft region</strong> and <strong>nationwide exceptional value</strong> (≥4 bed, €2,500–3,500).
            Refreshes itself every morning and evening after the scrape — same matches as the Telegram digest.
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
          <SummaryCard label="MATCHES" value={s?.matches ?? "—"} accent={T.ink} />
          <SummaryCard label="DELFT" value={s?.delft ?? "—"} accent={T.skyDark} />
          <SummaryCard label="VALUE" value={s?.value ?? "—"} accent={T.green} />
          <SummaryCard label="NEW" value={s?.newMatches ?? "—"} accent={T.amber} />
          <SummaryCard label="ALL SCRAPED" value={s?.total ?? "—"} accent={T.ink3} />
        </div>

        {/* Map */}
        <div
          style={{
            border: `1px solid ${T.line}`,
            borderRadius: 12,
            overflow: "hidden",
            background: T.bg2,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderBottom: `1px solid ${T.line}`,
              background: T.white,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: T.ink, fontWeight: 700, fontSize: 14 }}>
              <MapPin style={{ width: 16, height: 16, color: T.skyDark }} /> Live map
            </span>
            <a
              href={MAP_URL}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.skyDark, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
            >
              Open full map <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          </div>
          <iframe
            title="NL rental map"
            src={MAP_URL}
            loading="lazy"
            style={{ width: "100%", height: isMobile ? 360 : 520, border: 0, display: "block" }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <FilterChip label={`Matches${s ? ` (${s.matches})` : ""}`} active={view === "matches"} onClick={() => setView("matches")} />
          <FilterChip label={`All${s ? ` (${s.total})` : ""}`} active={view === "all"} onClick={() => setView("all")} />
          <span style={{ width: 1, height: 22, background: T.line, margin: "0 4px" }} />
          <FilterChip label="All tracks" active={track === "all"} onClick={() => setTrack("all")} />
          <FilterChip label="Delft" active={track === "delft"} onClick={() => setTrack("delft")} />
          <FilterChip label="Value" active={track === "value"} onClick={() => setTrack("value")} />
        </div>

        {error ? (
          <div style={{ padding: "16px 20px", color: T.red, background: T.redSoft, border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        {/* Findings list */}
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, overflow: "hidden" }}>
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px, 2.2fr) minmax(90px, 0.9fr) 90px 80px 90px minmax(120px, 1fr) 80px",
                gap: 12,
                padding: "11px 18px",
                borderBottom: `1px solid ${T.line}`,
                background: T.bg2,
                fontSize: 11,
                fontWeight: 700,
                color: T.ink3,
                letterSpacing: "0.03em",
              }}
            >
              <span>LISTING</span>
              <span>CITY</span>
              <span>€/MO</span>
              <span>€/M²</span>
              <span>VS PEERS</span>
              <span>TRACK</span>
              <span>SOURCE</span>
            </div>
          )}

          {data === null ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 28, fontSize: 14, color: T.ink3 }}>No listings for this filter.</div>
          ) : (
            filtered.map((l) => <ListingRow key={l.id} l={l} isMobile={isMobile} />)
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
          Showing {filtered.length} of {all.length} scraped listings · source: Funda + Pararius via the box pipeline.
        </div>
      </div>
    </div>
  );
}

(RentalPage as unknown as { path: string }).path = "/rental";
