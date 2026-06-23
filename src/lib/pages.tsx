import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import type { PageKey } from "./page-keys";

// Page components (single source of route → element for the whole dashboard).
import { HomePage } from "@/components/atomic-crm/pages/HomePage";
import { GoalsListPage } from "@/components/atomic-crm/goals/GoalsListPage";
import { GoalDetailPage } from "@/components/atomic-crm/goals/GoalDetailPage";
import { ProjectsListPage } from "@/components/atomic-crm/projects-dashboard/ProjectsListPage";
import { ProjectDetailPage } from "@/components/atomic-crm/projects-dashboard/ProjectDetailPage";
import { PortfolioPage } from "@/components/atomic-crm/pages/PortfolioPage";
import { SpendPage } from "@/components/atomic-crm/spend/SpendPage";
import { MovePage } from "@/components/atomic-crm/move/MovePage";
import { RentalPage } from "@/components/atomic-crm/rental/RentalPage";
import { SituationPage } from "@/components/atomic-crm/situation/SituationPage";
import { AgentsPage } from "@/components/atomic-crm/agents/AgentsPage";
import { SkillsPage } from "@/components/atomic-crm/skills/SkillsPage";
import { SkillDetailPage } from "@/components/atomic-crm/skills/SkillDetailPage";
import { MemoryPage } from "@/components/atomic-crm/memory/MemoryPage";
import { KnowledgeBaseListPage } from "@/components/atomic-crm/knowledge-base-list/KnowledgeBaseListPage";
import { KbBlueprintPage } from "@/components/atomic-crm/blueprint/KbBlueprintPage";
import { MeetingsPage } from "@/components/atomic-crm/pages/MeetingsPage";
import { MeetingDetailPage } from "@/components/atomic-crm/pages/MeetingDetailPage";
import { ToolsPage } from "@/components/atomic-crm/pages/ToolsPage";

/**
 * The grantable-page render manifest — ONE source of truth for which routes each
 * page owns. `CRM.tsx` renders these (all of them for the owner; only the granted
 * subset for a guest); nav lives in `nav-items.tsx`, keyed by the same `PageKey`.
 *
 * Owner-only chrome routes that are NOT grantable pages (`/`, `/settings`,
 * `/pitch-doc/*`, catch-all) stay in `CRM.tsx`.
 */
export interface PageDef {
  key: PageKey;
  routes: { path: string; element: ReactNode }[];
}

export const PAGES: PageDef[] = [
  { key: "home", routes: [{ path: "/home", element: <HomePage /> }] },
  {
    key: "goals",
    routes: [
      { path: "/goals", element: <Navigate to="/goals-list" replace /> },
      { path: "/goals-list", element: <GoalsListPage /> },
      { path: "/goals/:slug", element: <GoalDetailPage /> },
    ],
  },
  {
    key: "projects",
    routes: [
      { path: "/projects", element: <Navigate to="/projects-list" replace /> },
      { path: "/projects-list", element: <ProjectsListPage /> },
      { path: "/projects/:slug", element: <ProjectDetailPage /> },
    ],
  },
  { key: "portfolio", routes: [{ path: "/portfolio", element: <PortfolioPage /> }] },
  { key: "spend", routes: [{ path: "/spend", element: <SpendPage /> }] },
  { key: "move", routes: [{ path: "/move", element: <MovePage /> }] },
  { key: "rental", routes: [{ path: "/rental", element: <RentalPage /> }] },
  { key: "situation", routes: [{ path: "/situation", element: <SituationPage /> }] },
  { key: "agents", routes: [{ path: "/agents", element: <AgentsPage /> }] },
  {
    key: "skills",
    routes: [
      { path: "/skills", element: <SkillsPage /> },
      { path: "/skills/:slug", element: <SkillDetailPage /> },
    ],
  },
  { key: "memory", routes: [{ path: "/memory", element: <MemoryPage /> }] },
  {
    key: "knowledge-base",
    routes: [
      { path: "/knowledge-base", element: <KnowledgeBaseListPage /> },
      { path: "/kb-doc/*", element: <KbBlueprintPage /> },
    ],
  },
  {
    key: "meetings",
    routes: [
      { path: "/meetings", element: <MeetingsPage /> },
      { path: "/meetings/:id", element: <MeetingDetailPage /> },
    ],
  },
  { key: "tools", routes: [{ path: "/tools", element: <ToolsPage /> }] },
];
