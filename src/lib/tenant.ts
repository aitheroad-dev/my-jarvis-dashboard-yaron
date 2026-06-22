// Derive tenant identity from the URL — no env vars, no template placeholders.
// my-jarvis-dashboard-daniel.pages.dev → { slug: "daniel", displayName: "Daniel", initial: "D" }
//
// This way every tenant repo is byte-identical at the source level for these
// header/labels, and the actual tenant identity is read at runtime from the host.

export type TenantIdentity = {
  slug: string;
  displayName: string;
  initial: string;
};

const TEMPLATE_FALLBACK: TenantIdentity = {
  slug: "my-dashboard",
  displayName: "My Dashboard",
  initial: "M",
};

// Override the auto-derived "Title Case from kebab-case" displayName for slugs
// where the natural casing isn't right (acronyms, multi-word names without a
// dash in the URL, etc).
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  os: "OS",
  flameking: "Flame King",
};

export function getTenantIdentity(): TenantIdentity {
  if (typeof window === "undefined") return TEMPLATE_FALLBACK;

  const host = window.location.hostname;

  // Match my-jarvis-dashboard-{slug}.pages.dev (and preview variants like
  // <hash>.my-jarvis-dashboard-{slug}.pages.dev).
  const match = host.match(/my-jarvis-dashboard-([a-z0-9][a-z0-9-]*?)(?:\.pages\.dev|\.workers\.dev|$)/i);
  if (!match) return TEMPLATE_FALLBACK;

  const slug = match[1].toLowerCase();
  const displayName =
    DISPLAY_NAME_OVERRIDES[slug] ??
    slug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const initial = displayName.charAt(0).toUpperCase();

  return { slug, displayName, initial };
}
