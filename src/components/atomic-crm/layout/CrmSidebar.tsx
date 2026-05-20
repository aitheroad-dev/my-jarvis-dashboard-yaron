import { Link, useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { useAuth } from "@/lib/workos-shim";
import { getTenantIdentity } from "@/lib/tenant";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { myjarvisLogoUrl } from "./myjarvis-logo";
import { navItems, NavLink } from "./nav-items";

export function CrmSidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { displayName: tenantDisplayName } = getTenantIdentity();

  const fullName = [user?.firstName, user?.lastName]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  const displayName = fullName || user?.email || "User";
  const avatarUrl = user?.profilePictureUrl ?? undefined;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="hidden h-svh w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={myjarvisLogoUrl}
            alt={`${tenantDisplayName} logo`}
            className="h-8 w-8 rounded-lg object-cover"
          />
          <span className="text-sm font-semibold">
            {tenantDisplayName} Dashboard
          </span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 overflow-y-auto pt-6 pb-4">
        {navItems.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="px-2 pb-3 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <Avatar className="h-7 w-7">
                {avatarUrl && <AvatarImage src={avatarUrl} />}
                <AvatarFallback className="text-xs">{initial}</AvatarFallback>
              </Avatar>
              <span className="truncate">{displayName}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem
              onClick={() => navigate("/settings")}
              className="cursor-pointer"
            >
              <Settings className="h-4 w-4 me-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => signOut()}
              className="cursor-pointer"
            >
              <LogOut className="h-4 w-4 me-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
