/**
 * Google Calendar OAuth + event listing, plus AES-GCM at-rest encryption for
 * the long-lived refresh token. The only file that talks to Google.
 */

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // base64 of 32 random bytes — AES-256-GCM key for the refresh token at rest.
  CAL_TOKEN_KEY?: string;
}

// Must exactly match the redirect URI registered on the Google OAuth client.
export const APP_ORIGIN = "https://my-jarvis-dashboard-yaron.pages.dev";
export const REDIRECT_URI = `${APP_ORIGIN}/api/calendar/callback`;
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
];

export function googleConfigured(env: GoogleEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.CAL_TOKEN_KEY);
}

export function buildConsentUrl(env: GoogleEnv, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange an auth code for tokens (returns refresh_token on first consent). */
export async function exchangeCode(
  env: GoogleEnv,
  code: string,
): Promise<{ ok: true; accessToken: string; refreshToken: string | null } | { ok: false; detail: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    return { ok: false, detail: data.error_description || data.error || `token exchange ${res.status}` };
  }
  return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
}

/** Mint a fresh access token from the stored refresh token. */
export async function refreshAccessToken(
  env: GoogleEnv,
  refreshToken: string,
): Promise<{ ok: true; accessToken: string } | { ok: false; detail: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    return { ok: false, detail: data.error_description || data.error || `refresh ${res.status}` };
  }
  return { ok: true, accessToken: data.access_token };
}

/** Fetch the signed-in user's email (for display) via the userinfo endpoint. */
export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { email?: string };
  return data.email ?? null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  meetingUrl: string | null;
}

/** List upcoming events in [timeMin, timeMax]; only those with a Meet link matter to the caller. */
export async function listEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ ok: true; events: CalendarEvent[] } | { ok: false; detail: string }> {
  const p = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, detail: `events ${res.status}: ${detail.slice(0, 200)}` };
  }
  const data = (await res.json().catch(() => ({}))) as {
    items?: Array<{
      id?: string;
      summary?: string;
      hangoutLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    }>;
  };
  const events: CalendarEvent[] = (data.items ?? []).map((e) => {
    let meetingUrl: string | null = e.hangoutLink ?? null;
    if (!meetingUrl && e.conferenceData?.entryPoints) {
      const video = e.conferenceData.entryPoints.find(
        (ep) => ep.entryPointType === "video" && (ep.uri ?? "").includes("meet.google.com"),
      );
      meetingUrl = video?.uri ?? null;
    }
    return {
      id: e.id ?? "",
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      meetingUrl,
    };
  });
  return { ok: true, events };
}

// ── AES-GCM at-rest encryption for the refresh token ──

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(env: GoogleEnv): Promise<CryptoKey> {
  const raw = b64decode(env.CAL_TOKEN_KEY ?? "");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(env: GoogleEnv, plaintext: string): Promise<string> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return b64encode(joined);
}

export async function decryptToken(env: GoogleEnv, packed: string): Promise<string | null> {
  try {
    const key = await importKey(env);
    const raw = b64decode(packed);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
