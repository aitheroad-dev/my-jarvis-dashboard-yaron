import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { usePoints } from "../lib/store";
import { PALETTE, REGIONS, TAGS } from "../lib/taxonomy";
import { TagPill } from "../components/TagPill";
import { PoiCard } from "../components/PoiCard";
import { ChatPanel } from "../components/ChatPanel";

export function HomePage() {
  const points = usePoints();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [region, setRegion] = useState<string>("");
  const [search, setSearch] = useState("");

  function toggleTag(label: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim();
    return points.filter((p) => {
      if (region && p.region !== region) return false;
      if (activeTags.size && ![...activeTags].every((t) => p.tags.includes(t)))
        return false;
      if (q && !(p.name.includes(q) || p.description.includes(q))) return false;
      return true;
    });
  }, [points, region, activeTags, search]);

  const regionsInUse = useMemo(() => {
    const set = new Set(points.map((p) => p.region).filter(Boolean));
    return REGIONS.filter((r) => set.has(r));
  }, [points]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="topo map-card rounded-2xl px-5 py-7 text-center sm:px-8 sm:py-10">
        <div className="blaze-row mx-auto mb-4 max-w-xs" />
        <h1 className="hiking-display text-3xl sm:text-4xl" style={{ color: PALETTE.trail }}>
          מתכנן הטיולים בישראל
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base" style={{ color: PALETTE.ink }}>
          מאגר נבחר של מעיינות, תצפיות, מסלולים וחניוני לילה מכל הארץ. חפשו, סננו
          וקבלו הצעה מותאמת — נקודה בודדת או יום טיול שלם — הכול מתוך הרשימה
          הנבחרת בלבד.
        </p>
      </section>

      <ChatPanel />

      {/* Filters */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            className="flex flex-1 items-center gap-2 rounded-xl border bg-white px-3 py-2"
            style={{ borderColor: PALETTE.earth + "44" }}
          >
            <Search size={16} style={{ color: PALETTE.earth }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או תיאור…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="rounded-xl border bg-white px-3 py-2 text-sm outline-none"
            style={{ borderColor: PALETTE.earth + "44" }}
          >
            <option value="">כל האזורים</option>
            {regionsInUse.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <TagPill
              key={t.label}
              label={t.label}
              active={activeTags.has(t.label)}
              onClick={() => toggleTag(t.label)}
            />
          ))}
          {(activeTags.size > 0 || region || search) && (
            <button
              type="button"
              onClick={() => {
                setActiveTags(new Set());
                setRegion("");
                setSearch("");
              }}
              className="rounded-full px-3 py-1 text-sm underline"
              style={{ color: PALETTE.earth }}
            >
              ניקוי סינון
            </button>
          )}
        </div>
      </section>

      {/* Results */}
      <section>
        <div className="mb-3 text-sm" style={{ color: PALETTE.earth }}>
          {filtered.length} נקודות עניין
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: PALETTE.earth + "55", color: PALETTE.earth }}>
            לא נמצאו נקודות התואמות את הסינון.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <PoiCard key={p.id} point={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
