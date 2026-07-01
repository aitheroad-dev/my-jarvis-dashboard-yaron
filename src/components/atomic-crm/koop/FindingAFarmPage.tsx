// FindingAFarmPage.tsx — embeds the "Finding a Farm in NL" possibility-layer view
// (a self-contained interactive tool: filter/sort/search + clustered map + per-plot
// pages with verified Kadaster parcel, RP-v4 zoning, environment, taxes, contacts) as a
// full-height iframe over the static export at /farm-view/ (copied into /public, like the
// Report page). No internal /api/* access — see PAGE_API_PREFIXES ("finding-a-farm": []).
import { Sprout, ExternalLink } from "lucide-react";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

const FARM_URL = "/farm-view/index.html";

export function FindingAFarmPage() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "24px 32px 32px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, textTransform: "uppercase", marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sprout style={{ width: 14, height: 14 }} /> My Dashboard · Finding a Farm
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>Finding a Farm</h1>
          <p style={{ fontSize: 13, color: T.ink2, margin: "6px 0 0", maxWidth: 660, lineHeight: 1.5 }}>
            The regulatory "what can I do here" layer over the koop plots — verified Kadaster parcel,
            RP-v4 zoning (bestemming), environment, taxes and contacts. Green = verified at source · amber = needs verification.
          </p>
        </div>
        <a
          href={FARM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: T.accent, textDecoration: "none", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px", background: T.white, whiteSpace: "nowrap" }}
        >
          Open in new tab <ExternalLink style={{ width: 14, height: 14 }} />
        </a>
      </div>
      <iframe
        src={FARM_URL}
        title="Finding a Farm in NL"
        style={{ width: "100%", height: "calc(100vh - 190px)", minHeight: 520, border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, display: "block" }}
      />
    </div>
  );
}

(FindingAFarmPage as unknown as { path: string }).path = "/finding-a-farm";
