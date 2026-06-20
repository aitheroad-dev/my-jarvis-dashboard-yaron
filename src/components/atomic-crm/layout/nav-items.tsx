import { Link, matchPath, useLocation } from "react-router-dom";
import {
  Brain,
  Briefcase,
  Home,
  Library,
  PieChart,
  Radar,
  Sparkles,
  Target,
  Truck,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
};

// Sidebar nav. Every registered top-level route is exposed here. Settings is
// reachable from the avatar menu at the sidebar footer (not duplicated here).
// Detail routes (/goals/:slug, /meetings/:id, etc.) and doc catchalls
// (/kb-doc/*, /pitch-doc/*) are reached by drilling in, not from the sidebar.
export const navItems: NavItem[] = [
  { label: "Home", to: "/home", icon: Home },
  { label: "Goals", to: "/goals-list", icon: Target },
  { label: "Projects", to: "/projects-list", icon: Briefcase },
  { label: "Portfolio", to: "/portfolio", icon: PieChart },
  { label: "Move", to: "/move", icon: Truck },
  { label: "Situation", to: "/situation", icon: Radar },
  { label: "Agents", to: "/agents", icon: Users },
  { label: "Skills", to: "/skills", icon: Sparkles },
  { label: "Memory", to: "/memory", icon: Brain },
  { label: "Knowledge Base", to: "/knowledge-base", icon: Library },
  { label: "Meetings", to: "/meetings", icon: Video },
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
