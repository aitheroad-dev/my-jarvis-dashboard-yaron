import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { CrmSidebar } from "./CrmSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { VoicePanel, VoicePanelToggle } from "@/components/voice/VoicePanel";
import { useUserSettings } from "@/hooks/useUserSettings";

// Per-route background colors. The page wrapper bleeds past Layout's padding
// via negative margin to fill the column, but when the voice panel toggles
// open/closed, <main> resizes and any uncovered area shows main's own bg.
// To prevent a white surround on non-default-bg pages, we paint <main>
// with the same color the page itself uses.
//
// **When you add a page with a non-default background, register the route
// here so it survives voice-panel toggle.** This is the dashboard's
// canonical place to declare "this route owns the main background."
//
// MJOS-068 — the route arrays were heavily trimmed when the top-level route
// purge cut ~70 structure pages down to the 8 sidebar slugs + detail patterns.
// Everything that lives at /kb-doc/* or /pitch-doc/* picks up its chrome
// from the catchall entries here; /dashboard-architecture keeps an explicit
// row because it's the only named standards page outside the catchall.
const SKY_BLUE_BG = "#F2F7FD";

const SKY_BLUE_ROUTES = [
  "/dashboard-architecture",
  "/situation",
  "/agents",
  "/skills",
  "/projects",
  "/projects-list",
  "/goals",
  "/goals-list",
  // Generic Knowledge renderers inherit sky-blue chrome.
  "/kb-doc",
  // Knowledge Base list page.
  "/knowledge-base",
];

// **Three chrome variants** — Layout owns all page chrome (max-width +
// padding + bg). Pages render content directly; they don't add wrappers.
//
// - FULL_WIDTH_ROUTES: edge-to-edge, NO padding. Owning page provides its
//   own inner padding. Used by board / dashboard surfaces (Kanban, Operator,
//   Agents) where the page is a self-contained app shell.
// - NARROW_ROUTES: centered, `max-w-[1000px]` clamp with responsive
//   padding. Used by editorial KB pages (kb-doc, dashboard-architecture)
//   that prefer a narrower reading column.
// - default: centered, `max-w-6xl` (1152px) clamp with responsive padding.
//   The catch-all for typical detail / list pages.
const FULL_WIDTH_ROUTES = [
  "/agents",
];

const NARROW_ROUTES = [
  "/kb-doc",
  "/dashboard-architecture",
];

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

function backgroundForRoute(pathname: string): string | null {
  if (matchesRoute(pathname, SKY_BLUE_ROUTES)) return SKY_BLUE_BG;
  return null;
}

function isFullWidthRoute(pathname: string): boolean {
  return matchesRoute(pathname, FULL_WIDTH_ROUTES);
}

function isNarrowRoute(pathname: string): boolean {
  return matchesRoute(pathname, NARROW_ROUTES);
}

// Shell layout: left sidebar (nav), main content, right voice panel. The
// panel is a real layout column that grows from 0 to 400px instead of
// overlaying — content naturally reflows. The floating MessageCircle
// trigger only renders when the panel is closed; the panel's own close
// button handles the other direction.
export const Layout = ({ children }: { children: ReactNode }) => {
  // useUserSettings reads localStorage synchronously so `settings.voice_autoplay`
  // already reflects the user's preference on this very first render — no
  // flicker. The DB fetch in the hook updates the cache in the background;
  // the next page load picks it up at first paint. Manual open/close during
  // a session uses local state independent of the persisted preference.
  const { settings } = useUserSettings();
  const [voicePanelOpen, setVoicePanelOpen] = useState(
    () => settings.voice_autoplay !== false,
  );

  const location = useLocation();
  const customBg = backgroundForRoute(location.pathname);
  const fullWidth = isFullWidthRoute(location.pathname);
  const narrow = isNarrowRoute(location.pathname);

  // Chrome variant chosen by route. Layout owns max-width + padding so pages
  // render content directly with zero wrapper boilerplate.
  let contentClass: string;
  if (fullWidth) {
    // Bleed: no clamp, no padding. Page provides its own.
    contentClass = "flex-1";
  } else if (narrow) {
    // KB-style editorial: 1000px max with responsive padding.
    contentClass = "mx-auto w-full max-w-[1000px] flex-1 px-4 py-8 sm:px-8 sm:py-10 md:px-12";
  } else {
    // Default: 1152px (max-w-6xl) with responsive padding.
    contentClass = "mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8";
  }

  return (
    <div className="flex h-svh">
      <CrmSidebar />
      <main
        className={`relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto ${customBg ? "" : "bg-background"}`}
        style={customBg ? { background: customBg } : undefined}
      >
        <MobileTopBar />
        {!voicePanelOpen && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 hidden justify-end px-6 py-4 md:flex">
            <div className="pointer-events-auto">
              <VoicePanelToggle onClick={() => setVoicePanelOpen(true)} />
            </div>
          </div>
        )}
        <div className={contentClass}>{children}</div>
      </main>
      <div className="hidden md:contents">
        <VoicePanel open={voicePanelOpen} onClose={() => setVoicePanelOpen(false)} />
      </div>
    </div>
  );
};
