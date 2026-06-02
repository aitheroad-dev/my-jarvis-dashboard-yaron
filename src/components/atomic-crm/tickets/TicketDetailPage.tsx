// TicketDetailPage.tsx — MJOS-043 alignment
//
// Renders a single ticket via BlockRenderer + architectureConfig.
// Locked architecture (myjarvis-dashboard skill, "Page architecture doctrine"):
// detail pages generate a block recipe from the row's structured columns,
// then render through the same code path as /dashboard-architecture and
// /skills/:slug.
//
// Read-only — no interactive editing. CRUD happens via psql or a dedicated
// edit surface (locked 2026-05-11).

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import {
  architectureConfig,
  architectureT as T,
} from "../blueprint/ArchitectureBlocks";
import { BlockRenderer, type Block } from "../blueprint/BlockRenderer";

type ISC = { id: string; text: string; done: boolean };

type TicketDetail = {
  id: string;
  slug: string;
  project_id: string | null;
  project_name: string | null;
  goal_id: string | null;
  goal_title: string | null;
  parent_id: string | null;
  agent: string | null;
  title: string;
  status: "todo" | "in_progress" | "review" | "done" | "archived";
  tier: "E1" | "E2" | "E3" | "E4" | "E5" | null;
  current_step: string | null;
  isa_path: string | null;
  problem: string | null;
  vision: string | null;
  out_of_scope: string | null;
  principles: string | null;
  constraints: string | null;
  goal: string | null;
  test_strategy: string | null;
  features: string | null;
  decisions: string | null;
  changelog: string | null;
  verification: string | null;
  iscs: ISC[];
  log: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<TicketDetail["status"], { fg: string; bg: string; bd: string }> = {
  todo:        { fg: T.ink2, bg: T.bg2, bd: T.line },
  in_progress: { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  review:      { fg: T.plum, bg: T.plumSoft, bd: T.plum },
  done:        { fg: T.green, bg: T.greenSoft, bd: T.green },
  archived:    { fg: T.ink3, bg: T.bg2, bd: T.line },
};

// The 12 ISA sections plus log — order matters, this is the contract.
const SECTIONS: { key: keyof TicketDetail; label: string; eyebrow: string }[] = [
  { key: "problem",       label: "Problem",          eyebrow: "01 — PROBLEM" },
  { key: "vision",        label: "Vision",           eyebrow: "02 — VISION" },
  { key: "out_of_scope",  label: "Out of scope",     eyebrow: "03 — OUT OF SCOPE" },
  { key: "principles",    label: "Principles",       eyebrow: "04 — PRINCIPLES" },
  { key: "constraints",   label: "Constraints",      eyebrow: "05 — CONSTRAINTS" },
  { key: "goal",          label: "Goal",             eyebrow: "06 — GOAL" },
  // 07 is criteria/ISCs — handled separately below
  { key: "test_strategy", label: "Test strategy",    eyebrow: "08 — TEST STRATEGY" },
  { key: "features",      label: "Features",         eyebrow: "09 — FEATURES" },
  { key: "decisions",     label: "Decisions",        eyebrow: "10 — DECISIONS" },
  { key: "changelog",     label: "Changelog",        eyebrow: "11 — CHANGELOG" },
  { key: "verification",  label: "Verification",     eyebrow: "12 — VERIFICATION" },
];

function buildRecipe(t: TicketDetail): Block[] {
  const blocks: Block[] = [];

  // Chain context: parent project + goal links
  const chainBits: string[] = [];
  if (t.project_name) chainBits.push(`Project: [${t.project_name}](/projects/${t.project_id ? "" : ""})`);
  // Note: we don't have project slug in the response, only the id+name. Fall back to plain text in lede.

  const chainLine: string[] = [];
  if (t.project_name) chainLine.push(`**Project:** ${t.project_name}`);
  if (t.goal_title) chainLine.push(`**Goal:** ${t.goal_title}`);
  if (t.agent) chainLine.push(`**Agent:** ${t.agent}`);
  if (t.isa_path) chainLine.push(`**ISA:** \`${t.isa_path}\``);
  if (chainLine.length > 0) {
    blocks.push({
      type: "LivingBanner",
      props: {
        pillLabel: t.status.replace("_", " "),
        message: chainLine.join(" · "),
      },
    });
  }

  // 01-06 — ISA prose sections
  SECTIONS.slice(0, 6).forEach((s, idx) => {
    const value = (t[s.key] as string | null) ?? "";
    if (idx > 0) blocks.push({ type: "Divider", props: {} });
    blocks.push({ type: "SectionHeader", props: { eyebrow: s.eyebrow, title: s.label } });
    if (value.trim()) {
      blocks.push({ type: "P", props: { body: value } });
    } else {
      blocks.push({ type: "P", props: { body: "*Not yet specified.*" } });
    }
  });

  // 07 — Criteria (ISCs) as a DataTable
  blocks.push({ type: "Divider", props: {} });
  blocks.push({ type: "SectionHeader", props: { eyebrow: "07 — CRITERIA", title: `Criteria (${t.iscs.filter(i => i.done).length}/${t.iscs.length} done)` } });
  if (t.iscs.length === 0) {
    blocks.push({ type: "P", props: { body: "*No criteria defined yet — refine the ticket in OBSERVE/THINK and add ISCs.*" } });
  } else {
    blocks.push({
      type: "DataTable",
      props: {
        headers: ["ID", "Criterion", "Status"],
        rows: t.iscs.map(i => [
          `\`${i.id}\``,
          i.text,
          i.done ? "✓ done" : "○ open",
        ]),
      },
    });
  }

  // 08-12 — remaining ISA prose sections
  for (const s of SECTIONS.slice(6)) {
    const value = (t[s.key] as string | null) ?? "";
    blocks.push({ type: "Divider", props: {} });
    blocks.push({ type: "SectionHeader", props: { eyebrow: s.eyebrow, title: s.label } });
    if (value.trim()) {
      blocks.push({ type: "P", props: { body: value } });
    } else {
      blocks.push({ type: "P", props: { body: "*Not yet specified.*" } });
    }
  }

  // 13 — Log (read-only, monospace-ish via QuoteBlock)
  blocks.push({ type: "Divider", props: {} });
  blocks.push({ type: "SectionHeader", props: { eyebrow: "13 — LOG", title: "Log" } });
  if (t.log && t.log.trim()) {
    blocks.push({ type: "QuoteBlock", props: { body: t.log } });
  } else {
    blocks.push({ type: "P", props: { body: "*No log entries.*" } });
  }

  return blocks;
}

export function TicketDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const api = useApi();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setError(null);
    setTicket(null);
    (async () => {
      try {
        const res = await api(`/api/tickets/${slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as TicketDetail;
        if (!cancelled) setTicket(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const recipe = useMemo(() => ticket ? buildRecipe(ticket) : null, [ticket]);

  return (
    <div style={{
      fontFamily: "Inter, sans-serif",
      boxSizing: "border-box",
      padding: "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link to="/tickets" style={{
            color: T.accent, fontSize: 13, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <ChevronLeft style={{ width: 14, height: 14 }} /> Tickets
          </Link>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load ticket: <code>{slug}</code> — {error}
          </div>
        ) : ticket === null ? (
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
                {[ticket.slug, ticket.tier, ticket.current_step].filter(Boolean).join(" · ")}
              </div>
              <h1 style={{
                fontSize: 34, fontWeight: 800, color: T.ink,
                margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
              }}>
                {ticket.title}
              </h1>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: STATUS_TONE[ticket.status].fg,
                  background: STATUS_TONE[ticket.status].bg,
                  border: `1px solid ${STATUS_TONE[ticket.status].bd}`,
                  padding: "3px 10px", borderRadius: 999,
                }}>
                  {ticket.status.replace("_", " ")}
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
              Created {new Date(ticket.created_at).toLocaleString()} · Updated {new Date(ticket.updated_at).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

(TicketDetailPage as unknown as { path: string }).path = "/tickets/:slug";
