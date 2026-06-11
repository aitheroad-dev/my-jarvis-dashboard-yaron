// ProjectDetailPage.tsx — MJOS-043
//
// Renders a single project via BlockRenderer + architectureConfig.
// Locked architecture (myjarvis-dashboard skill, "Page architecture doctrine"):
// detail pages generate a block recipe from the row's structured columns,
// then render through the same code path as /dashboard-architecture.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import {
  architectureConfig,
  architectureT as T,
} from "../blueprint/ArchitectureBlocks";
import { BlockRenderer, type Block } from "../blueprint/BlockRenderer";

type ProjectDetail = {
  id: string;
  slug: string;
  name: string;
  mission: string | null;
  body: string | null;
  status: "active" | "paused" | "done" | "archived";
  created_at: string;
  updated_at: string;
  goals: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    status: string;
  }[];
};

// Parse a markdown body into block recipe entries.
// Supports `## ` headings (H3), `- ` bullet lists (UL), and paragraphs (P).
// Inline markdown (links, code, bold, italic) is handled by renderRich inside
// P / UL via the existing block components.
function parseBodyBlocks(body: string): Block[] {
  const out: Block[] = [];
  const lines = body.split("\n");
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length > 0) {
      out.push({ type: "UL", props: { items: bullets.slice() } });
      bullets = [];
    }
  };
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push({ type: "P", props: { body: paragraph.join(" ").trim() } });
      paragraph = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushBullets();
      flushParagraph();
      out.push({ type: "H3", props: { text: line.slice(3) } });
    } else if (line.startsWith("- ")) {
      flushParagraph();
      bullets.push(line.slice(2));
    } else if (line.trim() === "") {
      flushBullets();
      flushParagraph();
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushBullets();
  flushParagraph();
  return out;
}

function buildRecipe(p: ProjectDetail): Block[] {
  const blocks: Block[] = [];

  // 01 — MISSION (first section, no Divider before)
  blocks.push({ type: "SectionHeader", props: { eyebrow: "01 — MISSION", title: "What this project is for" } });
  blocks.push({ type: "Lede", props: { body: p.mission ?? "*No mission set yet.*" } });

  // 02 — DOCUMENTS & NOTES (only if body is set)
  if (p.body && p.body.trim().length > 0) {
    blocks.push({ type: "Divider", props: {} });
    blocks.push({ type: "SectionHeader", props: { eyebrow: "02 — DOCUMENTS & NOTES", title: "Related documents, links, and details" } });
    blocks.push(...parseBodyBlocks(p.body));
  }

  // 03 — GOALS
  blocks.push({ type: "Divider", props: {} });
  blocks.push({ type: "SectionHeader", props: { eyebrow: "03 — GOALS", title: `Goals under this project (${p.goals.length})` } });
  if (p.goals.length === 0) {
    blocks.push({ type: "P", props: { body: "*No goals linked yet.*" } });
  } else {
    blocks.push({
      type: "DataTable",
      props: {
        headers: ["Slug", "Title", "Description", "Status"],
        rows: p.goals.map(g => [
          `\`${g.slug}\``,
          `[${g.title}](/goals/${g.slug})`,
          g.description ?? "—",
          g.status,
        ]),
      },
    });
  }

  return blocks;
}

const STATUS_TONE: Record<ProjectDetail["status"], { fg: string; bg: string; bd: string }> = {
  active:   { fg: T.green, bg: T.greenSoft, bd: T.green },
  paused:   { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  done:     { fg: T.skyDark, bg: T.skySoft, bd: T.skyDark },
  archived: { fg: T.ink3, bg: T.bg2, bd: T.line },
};

export function ProjectDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const api = useApi();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setError(null);
    setProject(null);
    (async () => {
      try {
        const res = await api(`/api/projects/${slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProjectDetail;
        if (!cancelled) setProject(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const recipe = useMemo(() => project ? buildRecipe(project) : null, [project]);

  return (
    <div style={{
      fontFamily: "Inter, sans-serif",
      boxSizing: "border-box",
      padding: "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link to="/projects-list" style={{
            color: T.accent, fontSize: 13, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <ChevronLeft style={{ width: 14, height: 14 }} /> Projects
          </Link>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load project: <code>{slug}</code> — {error}
          </div>
        ) : project === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3,
            display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "32px 20px 40px", marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
              }}>
                PROJECT · {project.slug}
              </div>
              <h1 style={{
                fontSize: 34, fontWeight: 800, color: T.ink,
                margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
              }}>
                {project.name}
              </h1>
              {project.mission ? (
                <p style={{
                  fontSize: 16, color: T.ink2, lineHeight: 1.65,
                  maxWidth: 720, margin: "0 auto",
                }}>
                  {project.mission}
                </p>
              ) : null}
              <div style={{ marginTop: 20 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: STATUS_TONE[project.status].fg,
                  background: STATUS_TONE[project.status].bg,
                  border: `1px solid ${STATUS_TONE[project.status].bd}`,
                  padding: "3px 10px", borderRadius: 999,
                }}>
                  {project.status}
                </span>
              </div>
            </div>

            {recipe ? (
              <BlockRenderer config={architectureConfig} blocks={recipe} />
            ) : null}

            <div style={{
              fontSize: 11, color: T.ink3, paddingTop: 24,
              borderTop: `1px dashed ${T.line}`, marginTop: 48,
              textAlign: "center", letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              Updated {new Date(project.updated_at).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

(ProjectDetailPage as unknown as { path: string }).path = "/projects/:slug";
