// Shared types + helpers for the Situation Board pages.
// Data contract: functions/api/situation/*; writer: scripts/harvest-situation.ts.

export type SituationProject = {
  slug: string;
  name: string;
  goal: string | null;
  now_text: string | null;
  health: "active" | "quiet" | "stalled" | "no-signal" | string;
  last_activity: string | null;
  event_count: number;
  last_event_title: string | null;
  next_steps: string[];
};

export type SituationEvent = {
  id: string;
  ts: string;
  kind: "commit" | "session" | "milestone" | "deploy" | "note" | string;
  title: string;
  detail: string | null;
  source: string;
};

export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

export function relativeLabel(iso: string | null): string {
  const d = daysAgo(iso);
  if (d === null) return "never";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export const HEALTH_TONE: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  active: { label: "active", fg: "#0E7A3D", bg: "#E8F7EE", bd: "#0E7A3D" },
  quiet: { label: "quiet", fg: "#8A6D1A", bg: "#FBF3DC", bd: "#C9A227" },
  stalled: { label: "stalled", fg: "#B3261E", bg: "#FCEEED", bd: "#B3261E" },
  "no-signal": { label: "no signal", fg: "#FFFFFF", bg: "#B3261E", bd: "#7A150F" },
};

export function healthTone(health: string) {
  return HEALTH_TONE[health] ?? HEALTH_TONE.quiet;
}
