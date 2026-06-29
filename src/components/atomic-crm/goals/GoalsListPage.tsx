// GoalsListPage.tsx — MJOS-043
//
// Renders through the shared <SortableTable>. Locked architecture: every
// list page in the dashboard uses SortableTable, which guarantees the entire
// row navigates to the detail page (myjarvis-dashboard skill, "Page
// architecture doctrine").

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import { SortableTable, RowLink, type ColumnDef } from "../blueprint/SortableTable";

type GoalRow = {
  id: string;
  slug: string;
  project_id: string;
  project_name: string | null;
  title: string;
  description: string | null;
  status: "active" | "paused" | "done" | "archived";
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<GoalRow["status"], { fg: string; bg: string; bd: string }> = {
  active:   { fg: T.green, bg: T.greenSoft, bd: T.green },
  paused:   { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  done:     { fg: T.skyDark, bg: T.skySoft, bd: T.skyDark },
  archived: { fg: T.ink3,  bg: T.bg2,       bd: T.line },
};

function StatusPill({ status }: { status: GoalRow["status"] }) {
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

const COLUMNS: ColumnDef<GoalRow>[] = [
  {
    key: "slug", label: "Slug", width: "160px",
    render: (g) => (
      <code style={{
        background: T.skySoft, color: T.accent,
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 12, padding: "2px 8px", borderRadius: 4,
      }}>{g.slug}</code>
    ),
  },
  {
    key: "title", label: "Title",
    render: (g) => <RowLink to={`/goals/${g.slug}`}>{g.title}</RowLink>,
  },
  {
    key: "description", label: "Description", sortable: false,
    render: (g) => <span style={{ color: T.ink2 }}>{g.description ?? "—"}</span>,
  },
  {
    key: "project_name", label: "Project", width: "160px",
    render: (g) => <span style={{ color: T.ink2 }}>{g.project_name ?? "—"}</span>,
  },
  {
    key: "status", label: "Status", width: "100px",
    render: (g) => <StatusPill status={g.status} />,
  },
];

export function GoalsListPage() {
  const api = useApi();
  const [rows, setRows] = useState<GoalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/goals");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GoalRow[];
        if (!cancelled) setRows(data);
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
      padding: "clamp(20px, 5vw, 40px) clamp(14px, 5vw, 48px) 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "32px 20px 40px", marginBottom: 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
          }}>
            My Dashboard · Strategy
          </div>
          <h1 style={{
            fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 800, color: T.ink,
            margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            Goals
          </h1>
          <p style={{
            fontSize: 16, color: T.ink2, lineHeight: 1.65,
            maxWidth: 720, margin: "0 auto",
          }}>
            Strategic outcomes. The TELOS layer — light, few, long-horizon. Goals decompose into projects.
          </p>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load goals: {error}
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
            detailHref={(g) => `/goals/${g.slug}`}
            defaultSort={{ key: "title", dir: "asc" }}
            emptyMessage="No goals yet."
          />
        )}
      </div>
    </div>
  );
}

(GoalsListPage as unknown as { path: string }).path = "/goals-list";
