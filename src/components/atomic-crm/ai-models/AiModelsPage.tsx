import { ExternalLink, Boxes } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

// The AI Model Atlas — an interactive explorer of the mid-2026 model landscape.
// The explorer itself is a standalone, fully self-contained HTML file served from
// /public/reports (so it renders identically inside the dashboard iframe and when
// opened on its own). Data: 16 capability sections, ~200 models, family→line→model
// drill-down + search + modality/openness filters. Regenerate by re-copying the
// built explorer.html from the ai-model-landscape research artifact.

const ATLAS_URL = "/reports/ai-model-atlas.html";

export function AiModelsPage() {
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
              🗺️ AI Model Atlas
            </h1>
            <a
              href={ATLAS_URL}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.skyDark, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
            >
              Open full explorer <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          </div>
          <p style={{ fontSize: isMobile ? 14 : 15, color: T.ink2, lineHeight: 1.6, margin: "10px 0 0", maxWidth: 820 }}>
            A broad, web-sourced map of the AI models available today — organized as{" "}
            <strong>family → model line → individual model</strong>, each with its expertise and abilities.
            16 capability sections, ~200 models, ~50+ labs: language &amp; reasoning, image, video, audio, embeddings,
            coding, on-device, 3D, vision, safety, agentic, time-series, diffusion-LLMs, robotics and science.
            Search, filter by modality or open/closed, and drill in. Snapshot compiled{" "}
            <strong>2&nbsp;Jul&nbsp;2026</strong> (cross-vendor audited; benchmark claims spot-verify before publishing).
          </p>
        </div>

        {/* Embedded explorer */}
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
            <Boxes style={{ width: 16, height: 16, color: T.skyDark }} /> Model Atlas — interactive explorer
          </div>
          <iframe
            title="AI Model Atlas — interactive explorer"
            src={ATLAS_URL}
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

(AiModelsPage as unknown as { path: string }).path = "/ai-models";
