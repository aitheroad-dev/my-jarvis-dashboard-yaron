import { Link, NavLink, Outlet } from "react-router-dom";
import { Mountain } from "lucide-react";
import { PALETTE } from "../lib/taxonomy";

const NAV = [
  { to: "/", label: "בית", end: true },
  { to: "/poi/new", label: "הוספת נקודה", end: false },
  { to: "/import", label: "ייבוא CSV", end: false },
];

export function Layout() {
  return (
    <div className="hiking-app">
      <header className="topo border-b" style={{ borderColor: PALETTE.earth + "33", background: "#f6f1e0" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="blaze" style={{ height: 30 }} aria-hidden />
            <Mountain size={22} style={{ color: PALETTE.trail }} />
            <span className="hiking-display text-xl" style={{ color: PALETTE.trail }}>
              שביל הטיולים
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="rounded-full px-3 py-1.5 text-sm font-medium transition"
                style={({ isActive }) =>
                  isActive
                    ? { background: PALETTE.trail, color: "#fff" }
                    : { color: PALETTE.ink }
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="blaze-row" />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs" style={{ color: PALETTE.earth }}>
        מתכנן הטיולים בישראל · מאגר נקודות עניין נבחרות · פתוח לכולם
      </footer>
    </div>
  );
}
