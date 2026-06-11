// SituationPage.tsx — the Work Journal (v2, 2026-06-11). Not a project list:
// a day-by-day account of what was actually worked on, across EVERY stream —
// projects AND standalone work (PAI infra, tools, one-off sessions). Today,
// yesterday, back through two weeks. Per day, events cluster by stream; a
// summary strip names what moved today and what's gone stalled. The harvest
// timestamp renders on the page so a dead harvester is visible exactly where
// the data is consumed.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";
import { type SituationEvent, daysAgo } from "./situation-shared";
import { EventLine, dayKey } from "./StoryBlocks";

type JournalEvent = SituationEvent & { project_slug: string; label: string; link_slug: string | null };

type JournalProject = {
  slug: string;
  name: string;
  health: string;
  last_activity: string | null;
  link_slug: string | null;
};

type Journal = {
  last_harvest: string | null;
  events: JournalEvent[];
  projects: JournalProject[];
};

type StreamCluster = { label: string; link_slug: string | null; events: JournalEvent[] };
type DayGroup = { day: string; isToday: boolean; clusters: StreamCluster[] };

function buildDays(events: JournalEvent[]): DayGroup[] {
  const today = dayKey(new Date().toISOString());
  const byDay = new Map<string, JournalEvent[]>();
  for (const e of events) {
    const k = dayKey(e.ts);
    const list = byDay.get(k) ?? [];
    list.push(e);
    byDay.set(k, list);
  }
  return [...byDay.entries()].map(([day, evs]) => {
    const byStream = new Map<string, JournalEvent[]>();
    for (const e of evs) {
      const list = byStream.get(e.label) ?? [];
      list.push(e);
      byStream.set(e.label, list);
    }
    const clusters = [...byStream.entries()]
      .map(([label, list]) => ({ label, link_slug: list[0].link_slug, events: list }))
      .sort((a, b) => b.events.length - a.events.length);
    return { day, isToday: day === today, clusters };
  });
}

function StreamHeader({ c }: { c: StreamCluster }) {
  const title = (
    <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
      {c.label}
      <span style={{ fontWeight: 400, color: T.ink3, fontSize: 11 }}> · {c.events.length} {c.events.length === 1 ? "event" : "events"}</span>
    </span>
  );
  return c.link_slug ? (
    <Link to={`/projects/${c.link_slug}`} style={{ textDecoration: "none" }}>{title}</Link>
  ) : title;
}

export function SituationPage() {
  const api = useApi();
  const [data, setData] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/situation");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Journal;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => (data ? buildDays(data.events) : []), [data]);

  const movedToday = useMemo(() => {
    if (days.length === 0 || !days[0].isToday) return [];
    return days[0].clusters.map((c) => c.label);
  }, [days]);

  const stalled = useMemo(
    () => (data ? data.projects.filter((p) => p.health === "stalled" || p.health === "no-signal") : []),
    [data],
  );

  const harvestAge = data ? daysAgo(data.last_harvest) : null;
  const harvestStale = harvestAge !== null && harvestAge >= 2;

  return (
    <div style={{ fontFamily: "Inter, sans-serif", boxSizing: "border-box", padding: "40px 48px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "32px 20px 24px" }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
          }}>
            MyJarvis · Operations
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: T.ink, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
            Situation
          </h1>
          <p style={{ fontSize: 16, color: T.ink2, lineHeight: 1.65, maxWidth: 700, margin: "0 auto" }}>
            What we actually worked on — today, yesterday, the last two weeks. Every stream,
            projects and side-work alike, harvested from the work's own paper trail.
          </p>
          <div style={{
            marginTop: 12, fontSize: 11, letterSpacing: "0.04em",
            color: harvestStale ? "#B3261E" : T.ink3, fontWeight: harvestStale ? 700 : 400,
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
            Failed to load journal: {error}
          </div>
        ) : data === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <>
            {/* Pulse strip — what moved today, what's gone quiet. */}
            <div style={{
              background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12,
              padding: "12px 18px", marginBottom: 26, fontSize: 12.5, lineHeight: 1.7, color: T.ink2,
            }}>
              <div>
                <span style={{ fontWeight: 700, color: T.ink }}>Moved today: </span>
                {movedToday.length > 0 ? movedToday.join(" · ") : "nothing harvested yet today"}
              </div>
              {stalled.length > 0 ? (
                <div>
                  <span style={{ fontWeight: 700, color: "#B3261E" }}>Needs a look: </span>
                  {stalled.map((p, i) => (
                    <span key={p.slug}>
                      {i > 0 ? " · " : ""}
                      {p.link_slug
                        ? <Link to={`/projects/${p.link_slug}`} style={{ color: "#B3261E" }}>{p.name}</Link>
                        : <span style={{ color: "#B3261E" }}>{p.name}</span>}
                      <span style={{ color: T.ink3 }}> ({p.health})</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* The journal — day by day, clustered by stream. */}
            {days.map((d) => (
              <div key={d.day} style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: d.isToday ? T.skyDark : T.ink3, margin: "0 0 10px 2px",
                }}>
                  {d.isToday ? `Today — ${d.day}` : d.day}
                </div>
                {d.clusters.map((c) => (
                  <div key={c.label} style={{
                    background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10,
                    marginBottom: 10, overflow: "hidden",
                  }}>
                    <div style={{ padding: "9px 16px 7px", borderBottom: `1px solid ${T.line}`, background: "#FAFBFC" }}>
                      <StreamHeader c={c} />
                    </div>
                    {c.events.slice(0, 8).map((e, i) => (
                      <div key={e.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.line}` }}>
                        <EventLine e={e} label=" " />
                      </div>
                    ))}
                    {c.events.length > 8 ? (
                      <div style={{ padding: "6px 16px 10px", fontSize: 11, color: T.ink3 }}>
                        + {c.events.length - 8} more in this stream
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
            {days.length === 0 ? (
              <div style={{ padding: 24, fontSize: 13, color: T.ink3, textAlign: "center" }}>
                No events in the last 14 days — either a quiet fortnight or the harvester needs a run.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
