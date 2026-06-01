import { Link, matchPath, useLocation } from "react-router-dom";
import {
  Brain,
  Briefcase,
  Home,
  Library,
  PieChart,
  Sparkles,
  Target,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
};

// Template default sidebar (MJOS-074).
// Meetings route is registered in CRM.tsx but NOT in the sidebar by default —
// tenants opt in by adding `{ label: "Meetings", to: "/meetings", icon: Video }`
// once they're using the meetings feature.
export const navItems: NavItem[] = [
  { label: "Home", to: "/home", icon: Home },
  { label: "Goals", to: "/goals-list", icon: Target },
  { label: "Projects", to: "/projects-list", icon: Briefcase },
  { label: "Portfolio", to: "/portfolio", icon: PieChart },
  { label: "Tickets", to: "/tickets", icon: Ticket },
  { label: "Agents", to: "/agents", icon: Users },
  { label: "Skills", to: "/skills", icon: Sparkles },
  { label: "Memory", to: "/memory", icon: Brain },
  { label: "Knowledge Base", to: "/knowledge-base", icon: Library },
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

