// SituationDetailPage.tsx — one project's story: situation card, journey
// diagram (milestone path from first event to now), and the full timeline of
// harvested events grouped by day, newest first.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import {
  type SituationEvent,
  healthTone,
  relativeLabel,
} from "./situation-shared";

type SituationDetail = {
  slug: string;
  name: string;
  goal: string | null;
  now_text: string | null;
  health: string;
  last_activity: string | null;
  last_harvest: string | null;
  next_steps: string[];
  events: SituationEvent[];
};

const KIND_TONE: Record<string, string> = {
  milestone: "#0E7A3D",
  deploy: "#0E7A3D",
  session: "#2563EB",
  commit: "#6B7280",
  note: "#9333EA",
};

// Journey diagram — the path the project took. Milestones + deploys (plus the
// first and most recent event as endpoints) plotted left-to-right on a time
// axis. Pure SVG, derived entirely from harvested events.
function JourneyDiagram({ events }: { events: SituationEvent[] }) {
  const stops = useMemo(() => {
    const asc = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
    if (asc.length === 0) return [];
    const key = asc.filter((e) => e.kind === "milestone" || e.kind === "deploy");
    const picked = [asc[0], ...key, asc[asc.length - 1]];
    const seen = new Set<string>();
    const uniq = picked.filter((e) => !seen.has(e.id) && seen.add(e.id) !== undefined);
    return uniq.slice(-8); // last 8 stops keep the diagram readable
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

function dayKey(ts: string): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

export function SituationDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const api = useApi();
  const [data, setData] = useState<SituationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await api(`/api/situation/${slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as SituationDetail;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, SituationEvent[]>();
    for (const e of data.events) {
      const k = dayKey(e.ts);
      const list = byDay.get(k) ?? [];
      list.push(e);
      byDay.set(k, list);
    }
    return [...byDay.entries()];
  }, [data]);

  const tone = data ? healthTone(data.health) : null;

  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "40px 48px 80px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link to="/situation" style={{
            color: T.accent, fontSize: 13, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <ChevronLeft style={{ width: 14, height: 14 }} /> Situation
          </Link>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load <code>{slug}</code> — {error}
          </div>
        ) : data === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "16px 20px 28px" }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                color: T.skyDark, textTransform: "uppercase", marginBottom: 12,
              }}>
                SITUATION · {data.slug}
              </div>
              <h1 style={{ fontSize: 32, fontWeight: 800, color: T.ink, margin: "0 0 10px", letterSpacing: "-0.02em" }}>
                {data.name}
              </h1>
              {data.goal ? (
                <p style={{ fontSize: 15, color: T.ink2, lineHeight: 1.6, maxWidth: 720, margin: "0 auto 14px" }}>
                  {data.goal}
                </p>
              ) : null}
              {tone ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
                  padding: "3px 10px", borderRadius: 999,
                }}>
                  {tone.label} · last movement {relativeLabel(data.last_activity)}
                </span>
              ) : null}
            </div>

            {data.now_text || data.next_steps.length > 0 ? (
              <div style={{
                background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12,
                padding: "16px 20px", marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: T.ink2,
              }}>
                {data.now_text ? (
                  <div><span style={{ fontWeight: 700, color: T.ink }}>Now: </span>{data.now_text}</div>
                ) : null}
                {data.next_steps.length > 0 ? (
                  <div style={{ marginTop: data.now_text ? 8 : 0 }}>
                    <span style={{ fontWeight: 700, color: T.ink }}>Next:</span>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {data.next_steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <JourneyDiagram events={data.events} />

            <div style={{ marginTop: 24 }}>
              {grouped.map(([day, events]) => (
                <div key={day} style={{ marginBottom: 18 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase", color: T.ink3, margin: "0 0 8px 2px",
                  }}>
                    {day}
                  </div>
                  <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10 }}>
                    {events.map((e, i) => (
                      <div key={e.id} style={{
                        display: "flex", gap: 12, alignItems: "baseline",
                        padding: "10px 16px",
                        borderTop: i === 0 ? "none" : `1px solid ${T.line}`,
                      }}>
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          color: KIND_TONE[e.kind] ?? "#6B7280",
                          minWidth: 64,
                        }}>
                          {e.kind}
                        </span>
                        <span style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, flex: 1 }}>
                          {e.title}
                          {e.detail ? (
                            <span style={{ color: T.ink3, fontSize: 12 }}> — {e.detail}</span>
                          ) : null}
                        </span>
                        <span style={{ fontSize: 10.5, color: T.ink3, whiteSpace: "nowrap" }}>{e.source}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              fontSize: 11, color: T.ink3, paddingTop: 24,
              borderTop: `1px dashed ${T.line}`, marginTop: 32,
              textAlign: "center", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {data.last_harvest ? `Harvested ${new Date(data.last_harvest).toLocaleString()}` : "Never harvested"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
