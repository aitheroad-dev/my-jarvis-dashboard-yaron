import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/lib/api";

const T = {
  bg: "#FDF7F2",
  ink: "#1C1917",
  ink2: "#57534E",
  ink3: "#A8A29E",
  peachDark: "#E8814E",
  line: "#EADDD0",
  accent: "#C4602A",
  white: "#FFFFFF",
  green: "#2A7A4B",
  greenSoft: "#E8F3EC",
  red: "#B23A3A",
  redSoft: "#F7E5E2",
  blue: "#3B6BA5",
  blueSoft: "#E3EDF7",
};
const FONT = "Inter, system-ui, -apple-system, sans-serif";
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

type Meeting = {
  id: number;
  title: string;
  meeting_url: string;
  bot_id: string | null;
  status: string;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type Segment = {
  id: number;
  speaker_name: string | null;
  is_host: boolean | null;
  words: string;
  start_ts: string | null;
  end_ts: string | null;
  event_type: string | null;
  created_at: string;
};

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    live: { bg: T.greenSoft, fg: T.green, label: "Live" },
    starting: { bg: T.blueSoft, fg: T.blue, label: "Starting" },
    ended: { bg: "#F0EAE3", fg: T.ink3, label: "Ended" },
    failed: { bg: T.redSoft, fg: T.red, label: "Failed" },
    scheduled: { bg: "#F0EAE3", fg: T.ink3, label: "Scheduled" },
  };
  const c = cfg[status] ?? { bg: "#F0EAE3", fg: T.ink3, label: status };
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: FONT,
      }}
    >
      {c.label}
    </span>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const api = useApi();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      setLoadError("invalid meeting id");
      return;
    }
    // In-flight guard: a server pull can take longer than the 1s poll interval,
    // so without this, ticks stack up into overlapping concurrent requests.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await api(`/api/meetings/${id}`);
      if (!res.ok) {
        setLoadError(`Failed to load (${res.status})`);
        return;
      }
      const data = (await res.json()) as { meeting: Meeting; segments: Segment[] };
      setMeeting(data.meeting);
      // server returns newest-first; reverse for chronological display.
      setSegments([...data.segments].reverse());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll every 1s while the meeting is live or still starting. The server pulls
  // Vexa on each request but only writes D1 when the transcript actually
  // changed, so most polls are cheap reads. Lag to a live transcript line is
  // ~1s + Whisper inference.
  useEffect(() => {
    if (!meeting || (meeting.status !== "live" && meeting.status !== "starting")) return;
    const handle = window.setInterval(() => {
      // Skip while the tab is hidden (a backgrounded tab would poll for nobody)
      // or while a request is already outstanding.
      if (!stopRef.current && !inFlightRef.current && !document.hidden) void load();
    }, 1000);
    return () => window.clearInterval(handle);
  }, [meeting, load]);

  const handleStop = async () => {
    if (!meeting || stopping) return;
    setStopping(true);
    stopRef.current = true;
    try {
      const res = await api(`/api/meetings/${id}`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(data.error || `Stop failed (${res.status})`);
      }
      stopRef.current = false;
      void load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        fontFamily: FONT,
        color: T.ink,
        padding: "40px 8vw 80px",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link
          to="/meetings"
          style={{
            color: T.accent,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-block",
            marginBottom: 24,
          }}
        >
          ← All meetings
        </Link>

        {loadError && (
          <div
            style={{
              padding: "12px 16px",
              background: T.redSoft,
              color: T.red,
              borderRadius: 8,
              fontSize: 13.5,
              marginBottom: 16,
            }}
          >
            {loadError}
          </div>
        )}

        {meeting && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 24,
                marginBottom: 24,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <StatusBadge status={meeting.status} />
                  {meeting.bot_id && (
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: T.ink3 }}>
                      bot: {meeting.bot_id.slice(0, 8)}…
                    </span>
                  )}
                </div>
                <h1
                  style={{
                    fontSize: 32,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    margin: 0,
                    marginBottom: 8,
                  }}
                >
                  {meeting.title}
                </h1>
                <a
                  href={meeting.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13,
                    color: T.accent,
                    fontFamily: MONO,
                    textDecoration: "none",
                    wordBreak: "break-all",
                  }}
                >
                  {meeting.meeting_url}
                </a>
              </div>
              {(meeting.status === "live" || meeting.status === "starting") && (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopping}
                  style={{
                    padding: "10px 18px",
                    background: T.red,
                    color: T.white,
                    border: 0,
                    borderRadius: 8,
                    fontSize: 13.5,
                    fontWeight: 600,
                    fontFamily: FONT,
                    cursor: stopping ? "wait" : "pointer",
                    opacity: stopping ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {stopping ? "Stopping…" : "Stop recording"}
                </button>
              )}
            </div>

            {meeting.summary && (
              <div
                style={{
                  padding: "20px 24px",
                  background: T.white,
                  borderLeft: `3px solid ${T.peachDark}`,
                  borderRadius: "0 10px 10px 0",
                  marginBottom: 28,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    color: T.peachDark,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Summary
                </div>
                <div style={{ fontSize: 14.5, color: T.ink2, lineHeight: 1.6 }}>
                  {meeting.summary}
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: T.peachDark,
                  textTransform: "uppercase",
                }}
              >
                Live transcript
              </div>
              <div style={{ fontSize: 12, color: T.ink3 }}>
                {segments.length} segments
                {meeting.status === "live" || meeting.status === "starting"
                  ? " · live"
                  : ""}
              </div>
            </div>

            <div
              style={{
                background: T.white,
                border: `1px solid ${T.line}`,
                borderRadius: 12,
                padding: segments.length === 0 ? 32 : "12px 4px",
                minHeight: 240,
              }}
            >
              {segments.length === 0 ? (
                <div style={{ color: T.ink3, fontSize: 14, textAlign: "center" }}>
                  {meeting.status === "live"
                    ? "Waiting for the first words…"
                    : "No transcript captured."}
                </div>
              ) : (
                segments.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 1fr",
                      gap: 16,
                      padding: "10px 20px",
                      borderBottom: `1px solid ${T.line}`,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                        {s.speaker_name ?? "Unknown"}
                      </div>
                      <div style={{ fontSize: 11, color: T.ink3, fontFamily: MONO }}>
                        {fmtTime(s.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: 14.5, color: T.ink2, lineHeight: 1.55 }}>
                      {s.words}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {!meeting && !loadError && (
          <div style={{ color: T.ink3, fontSize: 14 }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
