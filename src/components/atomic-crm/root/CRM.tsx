import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "../layout/Layout";
import { useMe } from "@/lib/useMe";
import { PAGES } from "@/lib/pages";
import { navItems } from "../layout/nav-items";

// Owner-only chrome routes that are NOT grantable pages.
import { PitchDocBlueprintPage } from "../blueprint/PitchDocBlueprintPage";
import { SettingsPage } from "../pages/SettingsPage";

// All grantable page routes come from the PAGES manifest (lib/pages.tsx) — adding
// or sharing a page is a one-line change there + nav-items.tsx, never a rewrite
// here. The owner sees every page; a granted guest sees only their granted subset
// (cosmetic gate — the server `_middleware.ts` is the real authorization wall).
export const CRM = () => {
  const { isOwner, pages } = useMe();

  const visiblePages = isOwner ? PAGES : PAGES.filter((p) => pages.has(p.key));
  const pageRoutes = visiblePages.flatMap((p) =>
    p.routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />),
  );

  // Guest: only granted pages are routable; everything else lands on their first
  // granted page.
  if (!isOwner) {
    const landing = navItems.find((n) => pages.has(n.key))?.to ?? "/move";
    return (
      <Layout>
        <Routes>
          {pageRoutes}
          <Route path="*" element={<Navigate to={landing} replace />} />
        </Routes>
      </Layout>
    );
  }

  // Owner: every page + owner-only chrome.
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        {pageRoutes}
        <Route path="/pitch-doc/*" element={<PitchDocBlueprintPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Layout>
  );
};
