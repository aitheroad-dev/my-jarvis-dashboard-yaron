import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  amber: "#9A6B16",
  amberSoft: "#FBF0DD",
  blue: "#3B6BA5",
  blueSoft: "#E3EDF7",
  codeBg: "#F5EFE8",
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
  last_error: string | null;
  error_status: number | null;
};

type CalStatus = { configured: boolean; connected: boolean; email?: string | null };
type CalEvent = {
  google_event_id: string;
  title: string;
  start_time: string | null;
  meeting_url: string | null;
  platform: string | null;
  auto_join: number;
  dispatched_meeting_id: number | null;
  language: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Google Calendar connection + opt-in auto-join. Connect once; flip the toggle
 * on the meetings you want the bot to join automatically at their start time.
 */
function CalendarSection() {
  const api = useApi();
  const [status, setStatus] = useState<CalStatus | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api("/api/calendar");
      if (res.ok) setStatus((await res.json()) as CalStatus);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await api("/api/calendar/events");
      if (!res.ok) return;
      const data = (await res.json()) as { connected: boolean; events: CalEvent[] };
      setEvents(data.events ?? []);
    } catch {
      /* leave last-known list */
    }
  }, [api]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (status?.connected) void loadEvents();
  }, [status?.connected, loadEvents]);

  const toggle = async (gid: string, on: boolean) => {
    setEvents((evs) =>
      evs.map((e) => (e.google_event_id === gid ? { ...e, auto_join: on ? 1 : 0 } : e)),
    );
    try {
      await api(`/api/calendar/events/${encodeURIComponent(gid)}`, {
        method: "POST",
        body: JSON.stringify({ auto_join: on }),
      });
    } catch {
      void loadEvents(); // revert to server truth on failure
    }
  };

  const setLanguage = async (gid: string, lang: string) => {
    const value = lang === "he" || lang === "en" ? lang : null;
    setEvents((evs) =>
      evs.map((e) => (e.google_event_id === gid ? { ...e, language: value } : e)),
    );
    try {
      await api(`/api/calendar/events/${encodeURIComponent(gid)}`, {
        method: "POST",
        body: JSON.stringify({ language: lang }),
      });
    } catch {
      void loadEvents(); // revert to server truth on failure
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Google Calendar? Past transcripts are kept.")) return;
    await api("/api/calendar", { method: "POST" });
    setEvents([]);
    void loadStatus();
  };

  if (!status) return null;
  if (!status.configured) return null; // calendar not wired on this deployment

  return (
    <div
      style={{
        padding: 20,
        background: T.white,
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: T.peachDark,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Google Calendar
          </div>
          {status.connected ? (
            <div style={{ fontSize: 14.5, color: T.ink2 }}>
              Connected · <strong style={{ color: T.ink }}>{status.email}</strong> — flip a
              meeting on and the notetaker joins it automatically.
            </div>
          ) : (
            <div style={{ fontSize: 14, color: T.ink2 }}>
              Connect once. Then choose which upcoming meetings the bot should join on its own.
            </div>
          )}
        </div>
        {status.connected ? (
          <button
            type="button"
            onClick={disconnect}
            style={{
              padding: "8px 16px",
              background: T.white,
              color: T.ink2,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: "pointer",
            }}
          >
            Disconnect
          </button>
        ) : (
          <a
            href="/api/calendar/connect"
            style={{
              padding: "10px 18px",
              background: T.peachDark,
              color: T.white,
              border: `1px solid ${T.peachDark}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: FONT,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Connect Google Calendar
          </a>
        )}
      </div>

      {err && <div style={{ fontSize: 13, color: T.red, marginTop: 10 }}>{err}</div>}

      {status.connected && (
        <div style={{ marginTop: 18 }}>
          {events.length === 0 ? (
            <div style={{ fontSize: 13.5, color: T.ink3 }}>
              No upcoming meetings with a Meet link in the next 24 hours.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {events.map((e) => (
                <div
                  key={e.google_event_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 14px",
                    background: T.bg,
                    border: `1px solid ${T.line}`,
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink }}>{e.title}</div>
                    <div style={{ fontSize: 12.5, color: T.ink3 }}>
                      {fmtWhen(e.start_time)}
                      {e.dispatched_meeting_id ? " · bot dispatched" : ""}
                    </div>
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                    <select
                      value={e.language ?? "auto"}
                      onChange={(ev) => void setLanguage(e.google_event_id, ev.target.value)}
                      title="Transcription language"
                      style={{
                        fontSize: 12.5,
                        padding: "4px 6px",
                        borderRadius: 8,
                        border: `1px solid ${T.line}`,
                        background: T.white,
                        color: T.ink2,
                        cursor: "pointer",
                      }}
                    >
                      <option value="auto">Auto-detect</option>
                      <option value="he">עברית</option>
                      <option value="en">English</option>
                    </select>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <span style={{ fontSize: 12.5, color: e.auto_join ? T.green : T.ink3, fontWeight: 600 }}>
                        {e.auto_join ? "Auto-join on" : "Auto-join"}
                      </span>
                      <input
                        type="checkbox"
                        checked={e.auto_join === 1}
                        onChange={(ev) => void toggle(e.google_event_id, ev.target.checked)}
                        style={{ width: 18, height: 18, cursor: "pointer", accentColor: T.peachDark }}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    live: { bg: T.greenSoft, fg: T.green, label: "Live" },
    starting: { bg: T.blueSoft, fg: T.blue, label: "Starting" },
    ended: { bg: "#F0EAE3", fg: T.ink3, label: "Ended" },
    failed: { bg: T.redSoft, fg: T.red, label: "Failed" },
    stalled: { bg: T.amberSoft, fg: T.amber, label: "No audio" },
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

type Platform = "google_meet" | "zoom" | "teams";

type ParsedMeeting =
  | { ok: true; platform: Platform; nativeMeetingId: string; passcode?: string }
  | { ok: false; error: string };

// Mirrors the worker's parseVexaMeetingUrl in lib/vexa-bot.ts. Kept in sync
// by hand because the regex set is tiny and the worker stays the security
// boundary — this is purely a UX sanity check on paste.
function parseMeetingUrl(raw: string): ParsedMeeting {
  const meetingUrl = raw.trim();
  if (meetingUrl.length === 0) return { ok: false, error: "empty" };
  let u: URL;
  try {
    u = new URL(meetingUrl);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  const host = u.hostname.toLowerCase();

  if (host === "meet.google.com" || host.endsWith(".meet.google.com")) {
    const code = u.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    if (!/^[a-z0-9-]+$/i.test(code) || code.length < 5) {
      return { ok: false, error: "Doesn't look like a Meet code" };
    }
    return { ok: true, platform: "google_meet", nativeMeetingId: code };
  }

  if (host.endsWith("zoom.us")) {
    const m = u.pathname.match(/\/j\/(\d+)/);
    if (!m) return { ok: false, error: "Zoom URL needs /j/<id>" };
    const pwd = u.searchParams.get("pwd");
    return {
      ok: true,
      platform: "zoom",
      nativeMeetingId: m[1],
      passcode: pwd && pwd.length > 0 ? pwd : undefined,
    };
  }

  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) {
    const m = u.pathname.match(/\/l\/meetup-join\/([^/]+)/);
    if (!m) return { ok: false, error: "Teams URL needs /l/meetup-join/" };
    return { ok: true, platform: "teams", nativeMeetingId: decodeURIComponent(m[1]) };
  }

  return { ok: false, error: "Only Google Meet, Zoom, and Teams are supported" };
}

const PLATFORM_META: Record<Platform, { label: string; dot: string }> = {
  google_meet: { label: "Google Meet", dot: T.green },
  zoom: { label: "Zoom", dot: T.blue },
  teams: { label: "Microsoft Teams", dot: T.accent },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MeetingsPage() {
  const api = useApi();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [passcode, setPasscode] = useState("");
  const [language, setLanguage] = useState("he");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Parse on every keystroke so the platform pill + passcode field react live.
  // Cheap — just a regex set against the URL string.
  const parsed = useMemo(() => parseMeetingUrl(meetingUrl), [meetingUrl]);
  // Show the passcode input only for Zoom URLs that didn't carry pwd inline.
  const showPasscodeField = parsed.ok && parsed.platform === "zoom" && !parsed.passcode;

  const loadMeetings = useCallback(async () => {
    try {
      const res = await api("/api/meetings");
      if (!res.ok) {
        setLoadError(`Failed to load meetings (${res.status})`);
        return;
      }
      const data = (await res.json()) as { meetings: Meeting[]; configured?: boolean };
      setMeetings(data.meetings);
      setConfigured(data.configured !== false);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !parsed.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        meeting_url: meetingUrl.trim(),
        language,
      };
      // Send a typed passcode only when (a) URL didn't carry one and (b) the
      // user actually filled the field. URL-embedded `pwd` wins on the worker
      // side regardless, so this is purely the bare-URL case.
      if (showPasscodeField && passcode.trim().length > 0) {
        body.passcode = passcode.trim();
      }
      const res = await api("/api/meetings", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        setSubmitError(data.error || `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setTitle("");
      setMeetingUrl("");
      setPasscode("");
      setShowForm(false);
      void loadMeetings();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        fontFamily: FONT,
        color: T.ink,
        padding: "56px 8vw 80px",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 24,
            marginBottom: 36,
          }}
        >
          <div>
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                fontSize: 11,
                fontWeight: 700,
                color: T.peachDark,
                marginBottom: 12,
              }}
            >
              Meetings
            </div>
            <h1
              style={{
                fontSize: "clamp(32px, 4vw, 48px)",
                fontWeight: 600,
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
                margin: 0,
              }}
            >
              Send a notetaker into any meeting, from anywhere.
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            style={{
              padding: "10px 18px",
              background: showForm ? T.white : T.peachDark,
              color: showForm ? T.ink : T.white,
              border: showForm ? `1px solid ${T.line}` : `1px solid ${T.peachDark}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {showForm ? "Cancel" : "+ New meeting"}
          </button>
        </div>

        <CalendarSection />

        {!configured && (
          <div
            style={{
              padding: "14px 18px",
              background: T.blueSoft,
              color: T.blue,
              borderRadius: 10,
              fontSize: 13.5,
              lineHeight: 1.5,
              marginBottom: 20,
            }}
          >
            <strong>Almost there:</strong> the meeting agent isn't connected yet —
            the <code style={{ fontFamily: MONO }}>VEXA_API_KEY</code> secret is
            missing on this deployment. Past meetings still show below; creating
            new ones will work the moment the key is added.
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            style={{
              padding: 24,
              background: T.white,
              border: `1px solid ${T.line}`,
              borderRadius: 12,
              marginBottom: 24,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2 }}>Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. R&D weekly sync"
                style={{
                  padding: "10px 12px",
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: FONT,
                  background: T.bg,
                  color: T.ink,
                  outline: "none",
                }}
                disabled={submitting}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                Meeting URL
              </span>
              <input
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="Paste a Google Meet, Zoom, or Teams link"
                style={{
                  padding: "10px 12px",
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: MONO,
                  background: T.bg,
                  color: T.ink,
                  outline: "none",
                }}
                disabled={submitting}
              />
              {/* Platform pill — green for valid, red for unsupported,
                  hidden when the field is empty so we don't yell at users
                  mid-paste. */}
              {meetingUrl.trim().length > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    color: parsed.ok ? T.ink2 : T.red,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 2,
                  }}
                >
                  {parsed.ok ? (
                    <>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: PLATFORM_META[parsed.platform].dot,
                          display: "inline-block",
                        }}
                      />
                      Detected: {PLATFORM_META[parsed.platform].label}
                      {parsed.passcode && (
                        <span style={{ color: T.ink3 }}>
                          · passcode embedded
                        </span>
                      )}
                    </>
                  ) : (
                    <>{parsed.error}</>
                  )}
                </span>
              )}
            </label>
            {showPasscodeField && (
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                  Zoom passcode
                </span>
                <input
                  type="text"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Optional — only if the host requires one"
                  style={{
                    padding: "10px 12px",
                    border: `1px solid ${T.line}`,
                    borderRadius: 8,
                    fontSize: 14,
                    fontFamily: MONO,
                    background: T.bg,
                    color: T.ink,
                    outline: "none",
                  }}
                  disabled={submitting}
                />
                <span style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.4 }}>
                  Most Zoom share-links carry the passcode in the URL — this
                  field is for bare links where the host sent the passcode
                  separately.
                </span>
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                Language
              </span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={submitting}
                style={{
                  padding: "10px 12px",
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: FONT,
                  background: T.bg,
                  color: T.ink,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="he">Hebrew (עברית)</option>
                <option value="en">English</option>
                <option value="auto">Auto-detect (any language, per segment)</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
              <span style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.4, marginTop: 2 }}>
                Pick the dominant language of the meeting — it pins the
                transcriber and avoids per-segment language flapping.
              </span>
            </label>
            {submitError && (
              <div
                style={{
                  padding: "10px 14px",
                  background: T.redSoft,
                  color: T.red,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting || !title.trim() || !parsed.ok}
              style={{
                padding: "10px 18px",
                background: T.peachDark,
                color: T.white,
                border: 0,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting || !title.trim() || !parsed.ok ? 0.6 : 1,
                alignSelf: "flex-start",
                marginTop: 4,
              }}
            >
              {submitting ? "Starting…" : "Save & start recording"}
            </button>
          </form>
        )}

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

        {meetings === null && !loadError ? (
          <div style={{ color: T.ink3, fontSize: 14 }}>Loading…</div>
        ) : meetings && meetings.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              background: T.white,
              border: `1px dashed ${T.line}`,
              borderRadius: 12,
              textAlign: "center",
              color: T.ink2,
              fontSize: 14.5,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 8 }}>
              No meetings yet.
            </div>
            Click <em>New meeting</em>, paste a Meet, Zoom, or Teams URL, and
            a notetaker agent joins the call. The transcript lands here in
            real time and stays forever.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(meetings ?? []).map((m) => (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    padding: "18px 22px",
                    background: T.white,
                    border: `1px solid ${T.line}`,
                    borderRadius: 12,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 16,
                    alignItems: "center",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = T.peachDark)
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.line)}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 16.5,
                        fontWeight: 600,
                        color: T.ink,
                        marginBottom: 6,
                      }}
                    >
                      {m.title}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: T.ink3,
                        fontFamily: MONO,
                        wordBreak: "break-all",
                      }}
                    >
                      {m.meeting_url}
                    </div>
                    {m.last_error && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: m.status === "live" ? T.amber : T.red,
                          marginTop: 6,
                          lineHeight: 1.4,
                        }}
                      >
                        {m.status === "live"
                          ? `⚠️ ${m.last_error}`
                          : `Vexa rejected the bot${m.error_status ? ` (${m.error_status})` : ""}: ${m.last_error}`}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 6,
                    }}
                  >
                    <StatusBadge
                      status={m.status === "live" && m.last_error ? "stalled" : m.status}
                    />
                    <div style={{ fontSize: 12, color: T.ink3 }}>
                      {fmtDate(m.created_at)}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
