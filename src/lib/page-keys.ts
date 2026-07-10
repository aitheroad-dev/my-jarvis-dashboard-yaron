/**
 * Stable page-key enumeration shared across the front end (manifest in
 * `pages.tsx`, grant checks in `useMe.ts`, nav in `nav-items.tsx`).
 *
 * MUST stay in sync with the server's `functions/_lib/pages.ts` `PageKey` union —
 * the server is the authority on grants; this is the client's matching vocabulary.
 * Kept dependency-free on purpose so `useMe` doesn't pull in page components.
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
