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
  | "spend"
  | "move"
  | "rental"
  | "situation"
  | "agents"
  | "skills"
  | "memory"
  | "knowledge-base"
  | "meetings";

export const ALL_PAGE_KEYS: PageKey[] = [
  "home",
  "goals",
  "projects",
  "portfolio",
  "spend",
  "move",
  "rental",
  "situation",
  "agents",
  "skills",
  "memory",
  "knowledge-base",
  "meetings",
];
