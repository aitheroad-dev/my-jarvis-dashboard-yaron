# Plan — Dashboard Page Sharing (multi-person, per-page access)

> Status: **PROPOSED — review before build.** No code written, nothing deployed.
> Author: PAI · Date: 2026-06-22
> Decision owner: Yaron
> Chosen model (this session): **Both** — identity-based as the primary model, link-based as a deliberate quick-share. Phased build. Plan-first.

---

## Problem

The dashboard is single-tenant (Yaron = owner). We bolted on exactly one shared case — `noabarkai@gmail.com` → the move page — by **hardcoding it into three separate places**. Consequences:

1. **It doesn't generalize.** "Also give Noa Projects," or "share a new page with someone else," means editing code in several files every time.
2. **It's actively broken for Noa.** She passes Google + CF Access, then `/move` crashes with *"Something went wrong loading this page."* Root cause: the move role mounts `<CRM/>` **without** `VoiceChannelProvider` (`App.tsx:36`), but the shared `Layout` renders `<VoicePanel>` unconditionally (`Layout.tsx:130`), which calls `useVoiceChannel()` → `throw` (`VoiceChannelProvider.tsx:49`) → error boundary. The shell assumes the full app; a restricted user breaks it. **This is a symptom of the missing general model, not a one-off bug.**
3. **Two sharing systems already exist and conflict.** The login-free `move-share` worker (capability link) *and* the dashboard Google login (identity). The worker is currently dead (404 / error 1042, local source gone, no git backup). The coexistence is the confusion.

## Vision

One coherent model: **I (owner) reach everything everywhere; I grant any person any subset of pages; doing so is a config change today and a checkbox tomorrow — never a code rewrite.** A shared person gets a clean, working, restricted view — by either logging in (identity) or opening a link (capability), with identical behaviour downstream.

## The three gates (what any shared person passes through)

| Gate | Controls | Today | Target |
|------|----------|-------|--------|
| 🚪 Front door — **CF Access** | Can their email reach the login at all | per-person policy, hand-added | driven from the grant list (+ exempt path for links) |
| 🖥️ Front-end — **CRM / sidebar / Layout** | Which pages + nav render | hardcoded `if role==="move"` | render exactly the granted pages |
| 🔒 Back-end — **`functions/_middleware.ts`** *(the real wall)* | Which `/api/*` answer them | hardcoded move allowlist | allowed API prefixes derived from grants |

## Core design — one authorization core, two front doors

```
   🚪 Door 1: IDENTITY  (CF Access)   Google login → verified email → grant map
   🔗 Door 2: LINK      (token)       signed token in URL → grant set
                         │
                         ▼
              RESOLVED GRANT SET  =  a set of page keys
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                 ▼
  🔒 Server enforces  🖥️ Front-end renders  🎛️ Shell adapts
  (one middleware)    (one nav/route set)   (one restricted view)
```

Whether the credential is a CF Access JWT (identity) or a signed token (capability), it resolves to the **same** "set of granted pages," and every downstream layer is identical. That single rule is what stops "Both" from becoming two codebases.

---

## Data model

### Page manifest — one source of truth
A shared module importable by **both** `src/` (front-end) and `functions/` (middleware). Each shareable page declares its routes + the API paths it needs + chrome hints.

```ts
export type PageKey =
  | "home" | "goals" | "projects" | "portfolio" | "move"
  | "situation" | "agents" | "skills" | "memory"
  | "knowledge-base" | "meetings";

export interface PageDef {
  key: PageKey;
  label: string;          // sidebar label; supports Hebrew (e.g. "מעבר דירה")
  routes: string[];       // client routes, e.g. ["/move"]
  apiPrefixes: string[];  // server paths needed, e.g. ["/api/move"]
  needsVoice?: boolean;   // chrome hint — almost always false
}
```

Grounded mapping (from current `CRM.tsx` routes + the live `functions/api/*` inventory):

| key | routes | apiPrefixes |
|-----|--------|-------------|
| home | `/home` | (aggregates; verify at build) |
| goals | `/goals`,`/goals-list`,`/goals/:slug` | `/api/goals` |
| projects | `/projects`,`/projects-list`,`/projects/:slug` | `/api/projects` |
| portfolio | `/portfolio` | `/api/portfolio` |
| **move** | `/move` | `/api/move` |
| situation | `/situation` | `/api/situation` |
| agents | `/agents` | `/api/agents` |
| skills | `/skills`,`/skills/:slug` | `/api/skills` |
| memory | `/memory` | `/api/memories` |
| knowledge-base | `/knowledge-base`,`/kb-doc/*` | `/api/kb` |
| meetings | `/meetings`,`/meetings/:id` | `/api/meetings` |

**Always-allowed for any authenticated user** (self-scoped / infra): `/api/me`, `/api/version`, `/api/settings`. **Owner-only subsystem (not a shareable page):** `/api/voice*`. **Machine endpoints** (voice ingest, MCP) keep their own secret auth and fall through the middleware untouched.

### Grant map — the entire access model
```ts
// Phase 1: a typed config. Phase 3: a D1 table + admin UI.
export const GRANTS: Record<string, PageKey[] | "*"> = {
  "aitheroad@gmail.com": "*",       // owner — everything (force-set, lockout-safe)
  "noabarkai@gmail.com": ["move"],  // Noa — today move only; add keys to grant more
};
```

### Resolution helpers (shared)
```ts
grantedPages(email, env): Set<PageKey>      // "*" → all keys
allowedApiPrefixes(pages): string[]          // union of apiPrefixes + always-allowed
hasVoice(pages, email): boolean              // owner / explicit grant only
```

This **replaces** `Role = "admin" | "move"` and `roleFor()` in `functions/_lib/auth.ts` with a grant set. `roleFor` becomes a thin `grantsFor`. Owner force-included as `*` (preserve the existing lockout-safety guarantee).

---

## Build — 3 steps

### Step 1 — Shared core + grant-aware shell  *(fixes Noa properly; foundation for both doors)*
**Touches (no `MovePage` changes):**
- **NEW** `shared/pages.ts` (or `functions/_lib/pages.ts` re-exported to `src/`) — manifest + grant map + resolvers.
- `functions/_lib/auth.ts` — `Role` → grant set; `roleFor` → `grantsFor`; `/api/me` returns `{ email, pages }`.
- `functions/_middleware.ts` — allowed prefixes derived from grants; keep encoding-hardening (raw + decoded path, reject `..` / `//` / `\`); always-allow self-scoped + machine endpoints.
- `src/lib/useMe.ts` → `useGrants()` — returns granted page set; still fails toward owner-view on transient error (never lock the owner out).
- `src/components/atomic-crm/root/CRM.tsx` — render routes for granted pages; redirect ungranted → first granted page.
- `src/components/atomic-crm/layout/Layout.tsx` + `MobileTopBar.tsx` — **grant-aware shell**: render voice chrome only when `hasVoice`. ← **this is the correct Noa fix.**
- `src/App.tsx` — mount `VoiceChannelProvider` + `AutoplayManager` only when `hasVoice` (generalize the existing role check).
- `nav-items.tsx` / `CrmSidebar.tsx` — nav entries filtered by grant.

**Result:** Noa unblocked; "give Noa `projects` too" = one line in `GRANTS`.

### Step 2 — Link door (capability)
- A **CF-Access-exempt** entry: `/share/*` + the APIs it calls bypass CF Access at the edge (Access app config / bypass policy). The Function then does its **own** token auth — not open.
- Unified enforcement: `_middleware.ts` resolves grants from **either** a CF Access JWT (identity) **or** a valid share token (capability) → same downstream.
- Token = **signed** (HMAC, server secret) + **expiring** + **revocable** + **scoped** to specific page keys + **logged**. Replaces the dead `move-share` worker, done as part of this codebase + manifest (not a separate app over the DB).
- Honest note: a link is a bearer capability — "whoever has it." Mitigated by expiry + revocation + scope + audit.

### Step 3 — Sharing admin page  *(zero-code self-service)*
- D1: `grants(email, page_key, granted_by, granted_at)`, `share_links(id, token_hash, pages, label, created_at, expires_at, revoked)`.
- Owner-only `/sharing` page: per-person page checkboxes; generate/revoke links; ideally auto-add the person's email to the CF Access policy via the Access API (token already at `~/.config/cloudflare/access-api-token.txt`).
- Access audit log.

---

## Security model
- **Server is the only real wall** (`_middleware.ts` + per-handler `requireUser`). Front-end gating is cosmetic.
- Keep encoding-hardening already in `moveAllowed()` (raw + decoded, reject traversal) — generalize it to the grant check.
- Owner force-included as `*`; never lock the owner out (preserve current safety).
- Identity = CF Access JWT (RS256, verified, existing). Capability = signed/expiring/revocable token.
- **Hardening item:** add per-handler grant checks (defense in depth) so a middleware gap can't leak data — Step 1 minimum is middleware; per-handler can follow.

## Migration / cleanup
- Replace `admin|move` everywhere with grants (thin shims keep diff small).
- Retire the dead `move-share` worker — its job becomes the Step-2 link door. (Decision below.)
- Noa: `GRANTS["noabarkai@gmail.com"] = ["move"]` — identical behaviour, now extensible.

## ⚠️ Deploy hazard — dirty working tree
The repo has **uncommitted** changes: `MovePage.tsx` (+280/−84) + `functions/api/move/*`. **Cloudflare deploys the working folder, not git HEAD** — so any deploy ships that half-finished redesign live. Step 1 does **not** touch `MovePage`, so the clean path is to **stash** it before building/deploying Step 1, and handle the redesign separately. Must be resolved before any deploy.

## Open questions for Yaron (review)
1. **Shareable scope** — make *all* pages grantable, or curate? (e.g. Portfolio/Finances are sensitive — likely owner-only-forever.)
2. **Dead `move-share` worker** — delete now, or keep dormant until Step 2 replaces it?
3. **CF Access exempt path** for links (Step 2) — comfortable carving out `/share/*` from the edge gate?
4. **Step 3 CF Access automation** — auto-add guest emails via the stored Access token (convenient) vs. keep that manual (smaller attack surface)?
5. **Settings for restricted users** — minimal settings page, or hide it entirely?
6. **Interim** — Noa stays crashed until Step 1 ships. Want the ~10-line interim Layout fix deployed now to unblock her without prejudging this plan?

## Decisions log
- 2026-06-22 — Model = **Both** (identity primary + link quick-share). [Yaron]
- 2026-06-22 — Phased: core → link door → sharing UI. [PAI proposal]
- 2026-06-22 — **Plan-first, no build yet.** [Yaron]
