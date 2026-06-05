import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CalendarDays, ExternalLink, MapPin, Pencil, Plus } from "lucide-react";
import { addNote, usePoint, useNotes } from "../lib/store";
import { PALETTE } from "../lib/taxonomy";
import { TagPill } from "../components/TagPill";
import { MapView } from "../components/MapView";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PoiDetailPage() {
  const { id } = useParams();
  const point = usePoint(id);
  const rawNotes = useNotes(id ?? "");
  const notes = useMemo(
    () => [...rawNotes].sort((a, b) => b.date.localeCompare(a.date)),
    [rawNotes],
  );

  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(today());

  if (!point) {
    return (
      <div className="map-card rounded-2xl p-8 text-center">
        <p className="mb-3" style={{ color: PALETTE.ink }}>
          הנקודה לא נמצאה.
        </p>
        <Link to="/" className="underline" style={{ color: PALETTE.trail }}>
          חזרה לרשימה
        </Link>
      </div>
    );
  }

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim() || !point) return;
    addNote(point.id, noteText.trim(), noteDate);
    setNoteText("");
    setNoteDate(today());
  }

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm" style={{ color: PALETTE.earth }}>
        <ArrowRight size={15} />
        חזרה לכל הנקודות
      </Link>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h1 className="hiking-display text-3xl" style={{ color: PALETTE.trail }}>
              {point.name}
            </h1>
            <div className="mt-1 flex items-center gap-1 text-sm" style={{ color: PALETTE.earth }}>
              <MapPin size={15} />
              {point.region || "אזור לא ידוע"}
            </div>
          </div>

          {point.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {point.tags.map((t) => (
                <TagPill key={t} label={t} size="sm" />
              ))}
            </div>
          )}

          {point.description ? (
            <p className="text-sm leading-relaxed" style={{ color: "#5b5346" }}>
              {point.description}
            </p>
          ) : (
            <p className="text-sm italic" style={{ color: PALETTE.earth }}>
              אין עדיין תיאור — אפשר להוסיף דרך עריכת הנקודה.
            </p>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              to={`/poi/${point.id}/edit`}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium text-white"
              style={{ background: PALETTE.mustard }}
            >
              <Pencil size={14} />
              עריכת הנקודה
            </Link>
            {point.googleUrl && (
              <a
                href={point.googleUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-medium"
                style={{ borderColor: PALETTE.sea, color: PALETTE.sea }}
              >
                <ExternalLink size={14} />
                Google Maps
              </a>
            )}
          </div>
        </div>

        <div>
          {point.lat != null && point.lng != null ? (
            <MapView points={[point]} height={320} />
          ) : (
            <div
              className="map-card flex h-[320px] items-center justify-center rounded-2xl text-center text-sm"
              style={{ color: PALETTE.earth }}
            >
              אין מיקום מדויק על המפה לנקודה זו.
            </div>
          )}
        </div>
      </div>

      {/* Field notes */}
      <section className="map-card rounded-2xl p-4 sm:p-5">
        <h2 className="hiking-display mb-3 text-xl" style={{ color: PALETTE.trail }}>
          הערות שדה ({notes.length})
        </h2>

        <form onSubmit={submitNote} className="mb-4 grid gap-2 sm:grid-cols-[160px_1fr_auto]">
          <input
            type="date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            className="rounded-lg border bg-white px-3 py-2 text-sm outline-none"
            style={{ borderColor: PALETTE.earth + "44" }}
          />
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="עדכון מהשטח — מצב מים, גישה, צפיפות…"
            className="rounded-lg border bg-white px-3 py-2 text-sm outline-none"
            style={{ borderColor: PALETTE.earth + "44" }}
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: PALETTE.trail }}
          >
            <Plus size={15} />
            הוספה
          </button>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm" style={{ color: PALETTE.earth }}>
            עדיין אין הערות שדה. הוסיפו את הראשונה.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border bg-white/70 p-3"
                style={{ borderColor: PALETTE.earth + "22" }}
              >
                <div className="mb-1 flex items-center gap-1 text-xs font-semibold" style={{ color: PALETTE.sea }}>
                  <CalendarDays size={13} />
                  {n.date}
                </div>
                <p className="text-sm" style={{ color: PALETTE.ink }}>
                  {n.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
