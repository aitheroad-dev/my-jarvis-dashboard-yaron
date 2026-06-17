import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PointOfInterest } from "../lib/types";
import { tagDef, PALETTE } from "../lib/taxonomy";

interface MapViewProps {
  points: PointOfInterest[];
  /** When provided, draws an ordered route line through these points. */
  route?: PointOfInterest[];
  height?: number | string;
  /** Render numbered pins (1..n) — used for day-trip routes. */
  numbered?: boolean;
  onSelect?: (id: string) => void;
}

const ISRAEL_CENTER: LatLngExpression = [31.5, 35.0];

function pinColor(p: PointOfInterest): string {
  const first = p.tags.map((t) => tagDef(t)).find(Boolean);
  return first?.color ?? PALETTE.trail;
}

function makeIcon(color: string, label?: string): L.DivIcon {
  return L.divIcon({
    className: "hike-pin-wrap",
    html: `<div class="hike-pin" style="background:${color}"><span>${label ?? ""}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

function FitBounds({ points }: { points: PointOfInterest[] }) {
  const map = useMap();
  useEffect(() => {
    const coords = points
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => [p.lat as number, p.lng as number] as [number, number]);
    if (coords.length === 1) {
      map.setView(coords[0], 13);
    } else if (coords.length > 1) {
      map.fitBounds(coords as LatLngBoundsExpression, { padding: [40, 40] });
    }
  }, [map, points]);
  return null;
}

export function MapView({ points, route, height = 360, numbered, onSelect }: MapViewProps) {
  const mappable = useMemo(
    () => points.filter((p) => p.lat != null && p.lng != null),
    [points],
  );
  const routeLine: LatLngExpression[] = (route ?? [])
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => [p.lat as number, p.lng as number]);

  const indexOf = (id: string) =>
    route ? route.findIndex((p) => p.id === id) : -1;

  return (
    <div className="map-card" style={{ borderRadius: 12, overflow: "hidden" }}>
      <MapContainer
        center={ISRAEL_CENTER}
        zoom={7}
        scrollWheelZoom={false}
        style={{ height, width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenTopoMap (CC-BY-SA) · &copy; OpenStreetMap'
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          maxZoom={17}
        />
        <FitBounds points={mappable} />
        {routeLine.length > 1 && (
          <Polyline positions={routeLine} pathOptions={{ color: PALETTE.mustard, weight: 4, dashArray: "1 8" }} />
        )}
        {mappable.map((p) => {
          const order = indexOf(p.id);
          const label = numbered && order >= 0 ? String(order + 1) : undefined;
          return (
            <Marker
              key={p.id}
              position={[p.lat as number, p.lng as number]}
              icon={makeIcon(pinColor(p), label)}
              eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
            >
              <Popup>
                <strong>{p.name}</strong>
                <br />
                {p.region}
                {p.tags.length ? (
                  <div style={{ marginTop: 4, color: PALETTE.earth }}>
                    {p.tags.map((t) => tagDef(t)?.emoji ?? "").join(" ")}
                  </div>
                ) : null}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
