import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import type { PointOfInterest } from "../lib/types";
import { TagPill } from "./TagPill";
import { PALETTE, tagDef } from "../lib/taxonomy";

export function PoiCard({ point, index }: { point: PointOfInterest; index?: number }) {
  return (
    <Link
      to={`/poi/${point.id}`}
      className="map-card group flex flex-col overflow-hidden rounded-2xl transition hover:-translate-y-0.5"
    >
      <div className="relative h-32 overflow-hidden topo" style={{ background: PALETTE.cream }}>
        {point.imageUrl ? (
          <img
            src={point.imageUrl}
            alt={point.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-5xl opacity-80">{firstEmoji(point)}</span>
          </div>
        )}
        {typeof index === "number" && (
          <div
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: PALETTE.mustard }}
          >
            {index + 1}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="hiking-display text-lg leading-tight" style={{ color: PALETTE.ink }}>
          {point.name}
        </h3>
        <div className="flex items-center gap-1 text-xs" style={{ color: PALETTE.earth }}>
          <MapPin size={13} />
          {point.region || "אזור לא ידוע"}
          {point.lat == null && <span className="opacity-70">· ללא מיקום על המפה</span>}
        </div>
        {point.description && (
          <p className="line-clamp-2 text-sm" style={{ color: "#5b5346" }}>
            {point.description}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {point.tags.slice(0, 4).map((t) => (
            <TagPill key={t} label={t} size="sm" />
          ))}
        </div>
      </div>
    </Link>
  );
}

function firstEmoji(point: PointOfInterest): string {
  for (const t of point.tags) {
    const def = tagDef(t);
    if (def) return def.emoji;
  }
  return "⛰️";
}
