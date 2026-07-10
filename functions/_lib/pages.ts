/**
 * Page-sharing authorization model (server side — the real wall).
 *
 * ONE source of truth for: (a) which pages exist, (b) the `/api/*` prefixes each
 * page needs, and (c) the grant map (email → granted pages). `_middleware.ts`
 * derives every allow/deny decision from here; `/api/me` derives what the SPA may
 * render. The front-end render manifest lives in `src/lib/pages.tsx` and MUST keep
 * the same `PageKey` union in sync (kept small + flat on purpose).
 *
 * Model: the owner gets `"all"`; every other allow-listed user gets an explicit
 * set of page keys (deny-by-default — an unknown guest sees nothing but their own
 * self-scoped endpoints). To share a page with someone: add their email to the
 * allow-list (ACCESS_ALLOWED_EMAILS + CF Access edge) AND give them a grant in
 * D1 (or via the ACCESS_GRANTS env override).
 */

export type PageKey =
  | "home"
  | "goals"
  | "projects"
  | "portfolio"
  | "invest"
  | "spend"
  | "deployed-sites"
  | "move"
  | "rental"
  | "koop"
  | "koop-plots"
  | "finding-a-farm"
  | "report"
  | "situation"
  | "ai-models"
  | "agents"
  | "skills"
  | "memory"
  | "knowledge-base"
  | "meetings"
  | "tools";

export const ALL_PAGE_KEYS: PageKey[] = [
  "home",
  "goals",
  "projects",
  "portfolio",
  "invest",
  "spend",
  "deployed-sites",
  "move",
  "rental",
  "koop",
  "koop-plots",
  "finding-a-farm",
  "report",
  "situation",
  "ai-models",
  "agents",
  "skills",
  "memory",
  "knowledge-base",
  "meetings",
  "tools",
];

/**
 * Each page → the `/api/*` prefixes it needs. A granted user may reach exactly
 * the union of their pages' prefixes (plus ALWAYS_ALLOWED_API). This is the
 * security-critical mapping — keep it tight; never widen a page to an endpoint
 * it doesn't actually call.
 */
export const PAGE_API_PREFIXES: Record<PageKey, string[]> = {
  home: ["/api/situation", "/api/projects", "/api/goals"],
  goals: ["/api/goals"],
  projects: ["/api/projects"],
  portfolio: ["/api/portfolio"],
  invest: ["/api/invest"],
  spend: ["/api/spend"],
  "deployed-sites": ["/api/deployed-sites"],
  move: ["/api/move"],
  rental: ["/api/rental"],
  koop: ["/api/koop"],
  "koop-plots": ["/api/koop-plots"],
  // Finding a Farm embeds a static export from /public (/farm-view) — no internal /api/* access.
  "finding-a-farm": [],
  // Report page embeds a static HTML report from /public — no internal /api/* access.
  report: [],
  situation: ["/api/situation"],
  // AI Model Atlas embeds a static explorer from /public — no internal /api/* access.
  "ai-models": [],
  agents: ["/api/agents"],
  skills: ["/api/skills"],
  memory: ["/api/memories"],
  "knowledge-base": ["/api/kb"],
  meetings: ["/api/meetings"],
  // Tools page embeds the external pai-tools Worker (own origin + own key auth);
  // it needs no internal /api/* access, so no prefixes are granted here.
  tools: [],
};

/**
 * Self-scoped / infra endpoints any allow-listed user may reach regardless of
 * page grants: identity bootstrap, deploy-version poll, and per-user settings
 * (the settings handler is self-scoped to the caller).
 */
export const ALWAYS_ALLOWED_API = ["/api/me", "/api/version", "/api/settings"];

export type Grant = "all" | PageKey[];

/**
 * Default grant map. Owner is handled separately as `"all"`; never list the
 * owner here. Env `ACCESS_GRANTS` (JSON) overrides/extends this at deploy time
 * without a code change. Page grants now live in D1.
 */
const DEFAULT_GRANTS: Record<string, PageKey[]> = {};

interface GrantEnv {
  ACCESS_GRANTS?: string;
}

type PageGrantRow = { page_key: string };
type GrantedEmailRow = { email: string };

function isPageKey(value: string): value is PageKey {
  return (ALL_PAGE_KEYS as string[]).includes(value);
}

/** Parse the optional ACCESS_GRANTS env JSON; malformed input is ignored. */
function envGrants(env: GrantEnv): Record<string, PageKey[]> {
  if (!env.ACCESS_GRANTS) return {};
  try {
    const parsed = JSON.parse(env.ACCESS_GRANTS) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, PageKey[]> = {};
    for (const [email, keys] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(keys)) continue;
      const valid = keys.filter((k): k is PageKey => typeof k === "string" && isPageKey(k));
      out[email.toLowerCase()] = valid;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve a verified email's grant. Owner → "all". Otherwise the env override
 * wins over the code default; an unknown guest → `[]` (deny-by-default).
 */
export function grantFor(email: string, env: GrantEnv, isOwner: boolean): Grant {
  if (isOwner) return "all";
  const key = email.toLowerCase();
  const merged = { ...DEFAULT_GRANTS, ...envGrants(env) };
  return merged[key] ?? [];
}

/**
 * Resolve a verified email's runtime grant from D1 plus the emergency env
 * override. Owner → "all"; unknown non-owner → [] (deny-by-default).
 */
export async function resolveGrant(
  email: string,
  env: GrantEnv,
  isOwner: boolean,
  db: D1Database,
): Promise<Grant> {
  if (isOwner) return "all";
  const key = email.toLowerCase();
  const granted = new Set<PageKey>(envGrants(env)[key] ?? []);

  try {
    const { results } = await db
      .prepare("SELECT page_key FROM page_grants WHERE email = ?1")
      .bind(key)
      .all<PageGrantRow>();
    for (const row of results ?? []) {
      if (typeof row.page_key === "string" && isPageKey(row.page_key)) {
        granted.add(row.page_key);
      }
    }
  } catch {
    return [...granted];
  }

  return [...granted];
}

/** Distinct grant-recipient emails from D1, lowercased. */
export async function grantedEmails(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT DISTINCT email FROM page_grants")
    .all<GrantedEmailRow>();
  const emails = new Set<string>();
  for (const row of results ?? []) {
    if (typeof row.email === "string") {
      const email = row.email.trim().toLowerCase();
      if (email) emails.add(email);
    }
  }
  return emails;
}

/** Granted page keys as a set ("all" → every key). */
export function grantedKeys(grant: Grant): Set<PageKey> {
  return new Set(grant === "all" ? ALL_PAGE_KEYS : grant);
}

/** Allowed `/api/*` prefixes for a grant (non-owner). Owner short-circuits upstream. */
export function allowedApiPrefixes(grant: Grant): string[] {
  if (grant === "all") return ["/api/"]; // everything (owner; not normally reached)
  const set = new Set<string>(ALWAYS_ALLOWED_API);
  for (const key of grant) {
    for (const p of PAGE_API_PREFIXES[key] ?? []) set.add(p);
  }
  return [...set];
}

/**
 * Is `path` allowed under `prefixes`? Encoding/traversal hardened (mirrors the
 * prior `moveAllowed` guard): any `..`, `//`, or `\` rejects outright. A prefix
 * matches the exact path or a clean child segment (`/api/move` → `/api/move/123`,
 * never `/api/moves`).
 */
export function apiPathAllowed(path: string, prefixes: string[]): boolean {
  if (path.includes("..") || path.includes("//") || path.includes("\\")) {
    return false;
  }
  return prefixes.some((p) => {
    if (p === "/api/") return path === "/api" || path.startsWith("/api/");
    return path === p || path.startsWith(p + "/");
  });
}
