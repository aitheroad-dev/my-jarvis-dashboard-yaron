import { ExternalLink, FileText } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

// Static research report, embedded. The report itself is a standalone HTML file
// served from /public (so it renders identically inside the dashboard iframe and
// when opened on its own). Add new reports as more /reports/*.html files and swap
// REPORT_URL, or extend this page to a small index if it grows past one.

const REPORT_URL = "/reports/open-source-models.html";

export function ReportPage() {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box",
        padding: isMobile ? "20px 14px 40px" : "36px 44px 48px",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 8 }}>
            AI RESEARCH
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: "-0.02em" }}>
              📚 Open-source models
            </h1>
            <a
              href={REPORT_URL}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.skyDark, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
            >
              Open full report <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          </div>
          <p style={{ fontSize: isMobile ? 14 : 15, color: T.ink2, lineHeight: 1.6, margin: "10px 0 0", maxWidth: 820 }}>
            A field guide to running open models locally — what <strong>"open"</strong> actually means, the major
            families and their licenses, how they benchmark against Claude and GPT, how to run them on a Mac, and
            what to run on your <strong>48&nbsp;GB M4&nbsp;Pro</strong>. Researched 25&nbsp;Jun&nbsp;2026.
          </p>
        </div>

        {/* Embedded report */}
        <div
          style={{
            border: `1px solid ${T.line}`,
            borderRadius: 12,
            overflow: "hidden",
            background: T.white,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderBottom: `1px solid ${T.line}`,
              background: T.bg2,
              color: T.ink,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <FileText style={{ width: 16, height: 16, color: T.skyDark }} /> Field guide — full report
          </div>
          <iframe
            title="Open-source models — field guide"
            src={REPORT_URL}
            loading="lazy"
            style={{
              width: "100%",
              height: isMobile ? "calc(100vh - 240px)" : "calc(100vh - 220px)",
              minHeight: 560,
              border: 0,
              display: "block",
              background: T.white,
            }}
          />
        </div>
      </div>
    </div>
  );
}

(ReportPage as unknown as { path: string }).path = "/report";
