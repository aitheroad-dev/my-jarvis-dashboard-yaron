// ProjectsListPage.tsx — MJOS-043
//
// Renders through the shared <SortableTable>. Locked architecture: every
// list page in the dashboard uses SortableTable, which guarantees the entire
// row navigates to the detail page (myjarvis-dashboard skill, "Page
// architecture doctrine").

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { relativeLabel } from "../situation/situation-shared";
import { HealthPill } from "../situation/StoryBlocks";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import { SortableTable, RowLink, type ColumnDef } from "../blueprint/SortableTable";

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  mission: string | null;
  status: "active" | "paused" | "done" | "archived";
  goal_count: number;
  created_at: string;
  updated_at: string;
  // Joined client-side from /api/situation (harvested, optional).
  health?: string;
  last_activity?: string | null;
  now_text?: string | null;
};

type SituationSummary = {
  projects: {
    slug: string;
    name: string;
    now_text: string | null;
    health: string;
    last_activity: string | null;
    link_slug: string | null;
  }[];
};

const STATUS_TONE: Record<ProjectRow["status"], { fg: string; bg: string; bd: string }> = {
  active:   { fg: T.green, bg: T.greenSoft, bd: T.green },
  paused:   { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  done:     { fg: T.skyDark, bg: T.skySoft, bd: T.skyDark },
  archived: { fg: T.ink3,  bg: T.bg2,       bd: T.line },
};

function StatusPill({ status }: { status: ProjectRow["status"] }) {
  const tone = STATUS_TONE[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
      padding: "2px 10px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}

const COLUMNS: ColumnDef<ProjectRow>[] = [
  {
    key: "name", label: "Project", width: "220px",
    render: (p) => <RowLink to={`/projects/${p.slug}`}>{p.name}</RowLink>,
  },
  {
    key: "now_text", label: "Now", sortable: false,
    render: (p) => (
      <span style={{ color: T.ink2, fontSize: 12.5, lineHeight: 1.45, display: "inline-block" }}>
        {p.now_text ?? p.mission ?? "—"}
      </span>
    ),
  },
  {
    key: "health", label: "Health", width: "110px",
    render: (p) => p.health ? <HealthPill health={p.health} /> : <span style={{ color: T.ink3 }}>—</span>,
  },
  {
    key: "last_activity", label: "Last movement", width: "130px",
    render: (p) => (
      <span style={{ color: T.ink2, fontSize: 12 }}>
        {p.last_activity !== undefined ? relativeLabel(p.last_activity ?? null) : "—"}
      </span>
    ),
  },
  {
    key: "goal_count", label: "Goals", width: "70px",
    render: (p) => <span style={{ color: T.ink2 }}>{p.goal_count}</span>,
  },
  {
    key: "status", label: "Status", width: "100px",
    render: (p) => <StatusPill status={p.status} />,
  },
];

export function ProjectsListPage() {
  const api = useApi();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Projects are the spine; situation data is optional enrichment —
        // a failed situation fetch must never blank the list.
        const res = await api("/api/projects");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProjectRow[];
        let situation: SituationSummary | null = null;
        try {
          const sres = await api("/api/situation");
          if (sres.ok) situation = (await sres.json()) as SituationSummary;
        } catch { /* enrichment only */ }
        const enriched = data.map((p) => {
          const s = situation?.projects.find(
            (c) => c.link_slug === p.slug || c.slug === p.slug,
          );
          return s ? { ...p, health: s.health, last_activity: s.last_activity, now_text: s.now_text } : p;
        });
        enriched.sort((a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""));
        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      fontFamily: "Inter, sans-serif",
      boxSizing: "border-box",
      padding: "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "32px 20px 40px", marginBottom: 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
          }}>
            My Dashboard · Operations
          </div>
          <h1 style={{
            fontSize: 34, fontWeight: 800, color: T.ink,
            margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            Projects
          </h1>
          <p style={{
            fontSize: 16, color: T.ink2, lineHeight: 1.65,
            maxWidth: 720, margin: "0 auto",
          }}>
            Coordinated bodies of work, sorted by movement — where each one stands and when it last moved.
          </p>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load projects: {error}
          </div>
        ) : rows === null ? (
          <div style={{
            padding: 24, fontSize: 14, color: T.ink3,
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <SortableTable
            rows={rows}
            columns={COLUMNS}
            detailHref={(p) => `/projects/${p.slug}`}
            defaultSort={{ key: "name", dir: "asc" }}
            emptyMessage="No projects yet."
          />
        )}
      </div>
    </div>
  );
}

(ProjectsListPage as unknown as { path: string }).path = "/projects-list";
