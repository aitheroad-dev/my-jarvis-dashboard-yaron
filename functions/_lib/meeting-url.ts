import type { Platform } from "./vexa";

export type ParsedMeetingUrl =
  | { ok: true; platform: Platform; nativeMeetingId: string; passcode?: string }
  | { ok: false; error: string };

/**
 * Server-side meeting-URL parse — the security boundary. The UI runs the same
 * regex family purely as a paste-time sanity check; this one decides what is
 * actually sent to the bot vendor.
 */
export function parseMeetingUrl(raw: string): ParsedMeetingUrl {
  const meetingUrl = raw.trim();
  if (meetingUrl.length === 0) return { ok: false, error: "empty meeting URL" };
  let u: URL;
  try {
    u = new URL(meetingUrl);
  } catch {
    return { ok: false, error: "not a valid URL" };
  }
  const host = u.hostname.toLowerCase();

  if (host === "meet.google.com" || host.endsWith(".meet.google.com")) {
    const code = u.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    if (!/^[a-z0-9-]+$/i.test(code) || code.length < 5) {
      return { ok: false, error: "doesn't look like a Google Meet code" };
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

  return { ok: false, error: "only Google Meet, Zoom, and Teams are supported" };
}
