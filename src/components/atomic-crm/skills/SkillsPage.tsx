// SkillsPage.tsx — MJOS-043
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

type SkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  body_chars: number;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<SkillSummary["status"], { fg: string; bg: string; bd: string }> = {
  draft:    { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  active:   { fg: T.green, bg: T.greenSoft, bd: T.green },
  archived: { fg: T.ink3,  bg: T.bg2,       bd: T.line },
};

function StatusPill({ status }: { status: SkillSummary["status"] }) {
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

const COLUMNS: ColumnDef<SkillSummary>[] = [
  {
    key: "slug", label: "Slug", width: "120px",
    render: (s) => (
      <code style={{
        background: T.skySoft, color: T.accent,
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 12, padding: "2px 8px", borderRadius: 4,
      }}>{s.slug}</code>
    ),
  },
  {
    key: "name", label: "Name",
    render: (s) => <RowLink to={`/skills/${s.slug}`}>{s.name}</RowLink>,
  },
  {
    key: "description", label: "Description", sortable: false,
    render: (s) => <span style={{ color: T.ink2 }}>{s.description ?? "—"}</span>,
  },
  {
    key: "status", label: "Status", width: "100px",
    render: (s) => <StatusPill status={s.status} />,
  },
  {
    key: "body_chars", label: "Size", width: "90px",
    render: (s) => <span style={{ color: T.ink3, fontSize: 12 }}>{s.body_chars.toLocaleString()}</span>,
  },
  {
    key: "updated_at", label: "Updated", width: "120px",
    render: (s) => <span style={{ color: T.ink3, fontSize: 12 }}>{new Date(s.updated_at).toLocaleDateString()}</span>,
  },
];

export function SkillsPage() {
  const api = useApi();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/skills");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SkillSummary[];
        if (!cancelled) setSkills(data);
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
            My Dashboard · Org chart
          </div>
          <h1 style={{
            fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 800, color: T.ink,
            margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            Skills
          </h1>
          <p style={{
            fontSize: 16, color: T.ink2, lineHeight: 1.65,
            maxWidth: 720, margin: "0 auto",
          }}>
            Loadable role doctrines. Each row defines a role (CEO, Head of R&D, Head of Marketing, …) that any team agent can load when dispatched.
          </p>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load skills: {error}
          </div>
        ) : skills === null ? (
          <div style={{
            padding: 24, fontSize: 14, color: T.ink3,
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <SortableTable
            rows={skills}
            columns={COLUMNS}
            detailHref={(s) => `/skills/${s.slug}`}
            defaultSort={{ key: "name", dir: "asc" }}
            emptyMessage="No skills yet."
          />
        )}
      </div>
    </div>
  );
}

(SkillsPage as unknown as { path: string }).path = "/skills";
