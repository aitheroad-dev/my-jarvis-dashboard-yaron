import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "../layout/Layout";
import { useMe } from "@/lib/useMe";

// === Core domains (Structured) ===
import { ProjectsListPage } from "../projects-dashboard/ProjectsListPage";
import { ProjectDetailPage } from "../projects-dashboard/ProjectDetailPage";
import { GoalsListPage } from "../goals/GoalsListPage";
import { GoalDetailPage } from "../goals/GoalDetailPage";
import { SituationPage } from "../situation/SituationPage";
import { AgentsPage } from "../agents/AgentsPage";
import { MemoryPage } from "../memory/MemoryPage";
import { SkillsPage } from "../skills/SkillsPage";
import { SkillDetailPage } from "../skills/SkillDetailPage";
import { MeetingsPage } from "../pages/MeetingsPage";
import { MeetingDetailPage } from "../pages/MeetingDetailPage";
import { HomePage } from "../pages/HomePage";
import { PortfolioPage } from "../pages/PortfolioPage";
import { MovePage } from "../move/MovePage";
import { RentalPage } from "../rental/RentalPage";

// === Standards + chrome ===
import { KbBlueprintPage } from "../blueprint/KbBlueprintPage";
import { PitchDocBlueprintPage } from "../blueprint/PitchDocBlueprintPage";
import { KnowledgeBaseListPage } from "../knowledge-base-list/KnowledgeBaseListPage";
import { SettingsPage } from "../pages/SettingsPage";

// Template baseline (MJOS-074).
//
// Top-level slugs that ship with every fresh tenant:
//   /home  /goals(-list)  /projects(-list)  /situation  /agents
//   /skills  /memory  /knowledge-base
// Plus catchall renderers: /kb-doc/*, /pitch-doc/*.
// Plus detail patterns: /situation/:slug, /goals/:slug, /projects/:slug, /skills/:slug.
// Plus structured Meetings (route registered, sidebar entry off by default — flip
// it on per-tenant in nav-items.tsx when the user wants meetings).
// Plus /settings, reached via the sidebar account dropdown.
//
// AuthKitProvider + AuthGate in App.tsx gate this whole tree, so every route
// here assumes an authenticated user.
export const CRM = () => {
  const { role } = useMe();

  // Move users (Noa) are scoped to the SHARED pages — the move tracker and the
  // rental search. The dashboard frame is kept, but only /move and /rental are
  // routable; every other path redirects to /move. This is the cosmetic gate —
  // the server (_middleware.ts) is the real authorization wall.
  if (role === "move") {
    return (
      <Layout>
        <Routes>
          <Route path="/move" element={<MovePage />} />
          <Route path="/rental" element={<RentalPage />} />
          <Route path="*" element={<Navigate to="/move" replace />} />
        </Routes>
      </Layout>
    );
  }

  return (
  <Layout>
    <Routes>
      {/* Root → Home. */}
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage />} />

      {/* Meetings (Structured) — route registered, sidebar entry off by default. */}
      <Route path="/meetings" element={<MeetingsPage />} />
      <Route path="/meetings/:id" element={<MeetingDetailPage />} />

      {/* Goals (Structured list + Knowledge — Classic detail). */}
      <Route path="/goals" element={<Navigate to="/goals-list" replace />} />
      <Route path="/goals-list" element={<GoalsListPage />} />
      <Route path="/goals/:slug" element={<GoalDetailPage />} />

      {/* Projects (Structured list + Knowledge — Classic detail). */}
      <Route path="/projects" element={<Navigate to="/projects-list" replace />} />
      <Route path="/projects-list" element={<ProjectsListPage />} />
      <Route path="/projects/:slug" element={<ProjectDetailPage />} />

      {/* Situation — the Work Journal: day-by-day account of all work streams.
          Per-project stories live on /projects/:slug (v2 reframe, 2026-06-11). */}
      <Route path="/situation" element={<SituationPage />} />

      {/* Agents (Structured). */}
      <Route path="/agents" element={<AgentsPage />} />

      {/* Portfolio (Structured) — mirror of local pai-portfolio CLI. */}
      <Route path="/portfolio" element={<PortfolioPage />} />

      {/* Move tracker (Structured). */}
      <Route path="/move" element={<MovePage />} />

      {/* NL rental search — live map + findings, mirrored from the box. */}
      <Route path="/rental" element={<RentalPage />} />

      {/* Skills (Structured list + Knowledge — Classic detail). */}
      <Route path="/skills" element={<SkillsPage />} />
      <Route path="/skills/:slug" element={<SkillDetailPage />} />

      {/* Memory (Structured). */}
      <Route path="/memory" element={<MemoryPage />} />

      {/* Generic Knowledge renderers. */}
      <Route path="/kb-doc/*" element={<KbBlueprintPage />} />
      <Route path="/pitch-doc/*" element={<PitchDocBlueprintPage />} />

      {/* Knowledge Base index + named standards page. */}
      <Route path="/knowledge-base" element={<KnowledgeBaseListPage />} />

      {/* Settings (sidebar account dropdown). */}
      <Route path="/settings" element={<SettingsPage />} />

      {/* Anything else falls through to home. */}
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  </Layout>
  );
};
