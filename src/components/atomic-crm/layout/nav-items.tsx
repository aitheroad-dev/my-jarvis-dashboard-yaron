import { Link, matchPath, useLocation } from "react-router-dom";
import {
  Brain,
  Briefcase,
  Home,
  Library,
  MapPin,
  PieChart,
  Radar,
  Sparkles,
  Target,
  Truck,
  Users,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PageKey } from "@/lib/page-keys";

export type NavItem = {
  key: PageKey;
  label: string;
  to: string;
  icon: LucideIcon;
};

// Sidebar nav. Every registered top-level route is exposed here. Settings is
// reachable from the avatar menu at the sidebar footer (not duplicated here).
// Detail routes (/goals/:slug, /meetings/:id, etc.) and doc catchalls
// (/kb-doc/*, /pitch-doc/*) are reached by drilling in, not from the sidebar.
// `key` ties each entry to a grantable page (see lib/page-keys.ts) so the nav can
// be filtered to a guest's granted pages.
export const navItems: NavItem[] = [
  { key: "home", label: "Home", to: "/home", icon: Home },
  { key: "goals", label: "Goals", to: "/goals-list", icon: Target },
  { key: "projects", label: "Projects", to: "/projects-list", icon: Briefcase },
  { key: "portfolio", label: "Portfolio", to: "/portfolio", icon: PieChart },
  { key: "spend", label: "Spend", to: "/spend", icon: Wallet },
  { key: "move", label: "מעבר דירה", to: "/move", icon: Truck },
  { key: "rental", label: "Rental", to: "/rental", icon: MapPin },
  { key: "situation", label: "Situation", to: "/situation", icon: Radar },
  { key: "agents", label: "Agents", to: "/agents", icon: Users },
  { key: "skills", label: "Skills", to: "/skills", icon: Sparkles },
  { key: "memory", label: "Memory", to: "/memory", icon: Brain },
  { key: "knowledge-base", label: "Knowledge Base", to: "/knowledge-base", icon: Library },
  { key: "meetings", label: "Meetings", to: "/meetings", icon: Video },
];

export function NavLink({ item }: { item: NavItem }) {
  const location = useLocation();
  const active =
    item.to === "/"
      ? location.pathname === "/"
      : !!matchPath(item.to + "/*", location.pathname);

  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="h-[18px] w-[18px]" />
      <span>{item.label}</span>
    </Link>
  );
}
