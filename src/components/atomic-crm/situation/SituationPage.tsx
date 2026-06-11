// SituationPage.tsx — the Situation Board portfolio (replaced the Kanban
// work-item board, 2026-06-11). One card per project: Goal / Now / Next /
// Health, sorted by last movement. Stalled and no-signal projects are loud by
// design; the harvest timestamp renders on the page so a dead harvester is
// visible at the point of consumption.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import {
  type SituationProject,
  daysAgo,
  healthTone,
  relativeLabel,
} from "./situation-shared";

type Portfolio = {
  last_harvest: string | null;
  projects: SituationProject[];
};

function HealthPill({ health }: { health: string }) {
  const tone = healthTone(health);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
      padding: "2px 10px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {tone.label}
    </span>
  );
}

function ProjectCard({ p }: { p: SituationProject }) {
  const noSignal = p.health === "no-signal" || p.event_count === 0;
  return (
    <Link to={`/situation/${p.slug}`} style={{ textDecoration: "none" }}>
      <div style={{
        background: "#fff",
        border: `1px solid ${noSignal ? "#B3261E" : p.health === "stalled" ? "#E3A29E" : T.line}`,
        borderRadius: 12, padding: "18px 20px", height: "100%",
        boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>{p.name}</div>
          <HealthPill health={noSignal ? "no-signal" : p.health} />
        </div>

        {p.goal ? (
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{p.goal}</div>
        ) : null}

        {noSignal ? (
          <div style={{
            fontSize: 12, color: "#B3261E", fontWeight: 600,
            background: "#FCEEED", borderRadius: 6, padding: "8px 10px",
          }}>
            No events harvested for this project — source mapping gap, not silence.
          </div>
        ) : (
          <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: T.ink }}>Now: </span>
            {p.now_text ?? p.last_event_title ?? "—"}
          </div>
        )}

        {p.next_steps.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.ink2, lineHeight: 1.6 }}>
            {p.next_steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        ) : null}

        <div style={{
          marginTop: "auto", paddingTop: 8, borderTop: `1px dashed ${T.line}`,
          display: "flex", justifyContent: "space-between",
          fontSize: 11, color: T.ink3,
        }}>
          <span>last movement: {relativeLabel(p.last_activity)}</span>
          <span>{p.event_count} events</span>
        </div>
      </div>
    </Link>
  );
}

export function SituationPage() {
  const api = useApi();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/situation");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Portfolio;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const harvestAge = data ? daysAgo(data.last_harvest) : null;
  const harvestStale = harvestAge !== null && harvestAge >= 2;

  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "40px 48px 80px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "32px 20px 28px", marginBottom: 8 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
          }}>
            MyJarvis · Operations
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: T.ink, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
            Situation
          </h1>
          <p style={{ fontSize: 16, color: T.ink2, lineHeight: 1.65, maxWidth: 720, margin: "0 auto" }}>
            Every project's story at a glance — what's moving, what's stalled, what's next.
            Derived from the work's own paper trail; nothing here is hand-maintained.
          </p>
          <div style={{
            marginTop: 14, fontSize: 11, letterSpacing: "0.04em",
            color: harvestStale ? "#B3261E" : T.ink3,
            fontWeight: harvestStale ? 700 : 400,
          }}>
            {data === null
              ? "…"
              : data.last_harvest
                ? `last harvest: ${new Date(data.last_harvest).toLocaleString()}${harvestStale ? " — STALE, harvester may be dead" : ""}`
                : "NEVER HARVESTED — run scripts/harvest-situation.ts"}
          </div>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load situation: {error}
          </div>
        ) : data === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}>
            {data.projects.map((p) => <ProjectCard key={p.slug} p={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}
