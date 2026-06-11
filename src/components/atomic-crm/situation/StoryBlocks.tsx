// StoryBlocks.tsx — shared rendering for a work stream's story: health pill,
// journey diagram (milestone path on a time axis), and day-grouped event
// timeline. Used by the Projects detail page (per-project story) and the
// Situation Work Journal.

import { useMemo } from "react";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import { type SituationEvent, healthTone } from "./situation-shared";

export const KIND_TONE: Record<string, string> = {
  milestone: "#0E7A3D",
  deploy: "#0E7A3D",
  session: "#2563EB",
  decision: "#B45309",
  pivot: "#B45309",
  commit: "#6B7280",
  note: "#9333EA",
};

export function HealthPill({ health, suffix }: { health: string; suffix?: string }) {
  const tone = healthTone(health);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
      color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
      padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {tone.label}{suffix ? ` · ${suffix}` : ""}
    </span>
  );
}

export function JourneyDiagram({ events }: { events: SituationEvent[] }) {
  const stops = useMemo(() => {
    const asc = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
    if (asc.length === 0) return [];
    const key = asc.filter((e) => e.kind === "milestone" || e.kind === "deploy");
    const picked = [asc[0], ...key, asc[asc.length - 1]];
    const seen = new Set<string>();
    const uniq = picked.filter((e) => !seen.has(e.id) && seen.add(e.id) !== undefined);
    return uniq.slice(-8);
  }, [events]);

  if (stops.length < 2) return null;

  const W = 920, H = 130, PAD = 60;
  const t0 = new Date(stops[0].ts).getTime();
  const t1 = new Date(stops[stops.length - 1].ts).getTime();
  const span = Math.max(t1 - t0, 1);
  const x = (ts: string) => PAD + ((new Date(ts).getTime() - t0) / span) * (W - 2 * PAD);

  return (
    <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 10px 4px", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 700, height: "auto", display: "block" }}>
        <line x1={PAD} y1={62} x2={W - PAD} y2={62} stroke={T.line} strokeWidth={2} />
        {stops.map((e, i) => {
          const cx = x(e.ts);
          const above = i % 2 === 0;
          const color = KIND_TONE[e.kind] ?? "#6B7280";
          const label = e.title.length > 34 ? `${e.title.slice(0, 33)}…` : e.title;
          return (
            <g key={e.id}>
              <circle cx={cx} cy={62} r={i === stops.length - 1 ? 7 : 5} fill={color} />
              <line x1={cx} y1={62} x2={cx} y2={above ? 44 : 80} stroke={color} strokeWidth={1} />
              <text x={cx} y={above ? 36 : 94} textAnchor="middle" fontSize={10.5} fill={T.ink2}>
                {label}
              </text>
              <text x={cx} y={above ? 24 : 106} textAnchor="middle" fontSize={9} fill={T.ink3}>
                {new Date(e.ts).toLocaleDateString()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function dayKey(ts: string): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

export function EventLine({ e, label }: { e: SituationEvent; label?: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "9px 16px" }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
        color: KIND_TONE[e.kind] ?? "#6B7280", minWidth: 64,
      }}>
        {e.kind}
      </span>
      <span style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, flex: 1 }}>
        {e.title}
        {e.detail ? <span style={{ color: T.ink3, fontSize: 12 }}> — {e.detail}</span> : null}
      </span>
      <span style={{ fontSize: 10.5, color: T.ink3, whiteSpace: "nowrap" }}>{label ?? e.source}</span>
    </div>
  );
}

export function EventTimeline({ events, maxDays }: { events: SituationEvent[]; maxDays?: number }) {
  const grouped = useMemo(() => {
    const byDay = new Map<string, SituationEvent[]>();
    for (const e of events) {
      const k = dayKey(e.ts);
      const list = byDay.get(k) ?? [];
      list.push(e);
      byDay.set(k, list);
    }
    const entries = [...byDay.entries()];
    return maxDays ? entries.slice(0, maxDays) : entries;
  }, [events, maxDays]);

  return (
    <div>
      {grouped.map(([day, evs]) => (
        <div key={day} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: T.ink3, margin: "0 0 8px 2px",
          }}>
            {day}
          </div>
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10 }}>
            {evs.map((e, i) => (
              <div key={e.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.line}` }}>
                <EventLine e={e} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
