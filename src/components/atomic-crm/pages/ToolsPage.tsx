// ToolsPage.tsx — embeds the shared pai-tools console (image / speech-to-text /
// text-to-speech / OCR) as a full-height iframe. pai-tools is a separate,
// multi-tenant-by-key Cloudflare Worker; its /app console gates client-side on a
// pasted pt_ key (stored in localStorage on the pai-tools origin, inside the
// iframe). The dashboard needs no internal /api for this page — see PAGE_API_PREFIXES
// (tools: []) in functions/_lib/pages.ts.
import { Wrench, ExternalLink } from "lucide-react";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

const TOOLS_URL = "https://pai-tools.aitheroad.workers.dev/app";

export function ToolsPage() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "24px 32px 32px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, textTransform: "uppercase", marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Wrench style={{ width: 14, height: 14 }} /> My Dashboard · Tools
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>Tools</h1>
          <p style={{ fontSize: 13, color: T.ink2, margin: "6px 0 0", maxWidth: 640, lineHeight: 1.5 }}>
            Image generation, speech-to-text, text-to-speech, and OCR — powered by pai-tools. Paste your key once to connect.
          </p>
        </div>
        <a
          href={TOOLS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: T.accent, textDecoration: "none", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px", background: T.white, whiteSpace: "nowrap" }}
        >
          Open in new tab <ExternalLink style={{ width: 14, height: 14 }} />
        </a>
      </div>
      <iframe
        src={TOOLS_URL}
        title="PAI Tools"
        allow="clipboard-write; microphone"
        style={{ width: "100%", height: "calc(100vh - 170px)", minHeight: 480, border: `1px solid ${T.line}`, borderRadius: 12, background: T.white, display: "block" }}
      />
    </div>
  );
}

(ToolsPage as unknown as { path: string }).path = "/tools";
