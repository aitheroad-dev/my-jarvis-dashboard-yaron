// Small geo helpers (no external deps).

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Order a set of points into a short walking/driving chain using a greedy
 * nearest-neighbour heuristic, starting from `start` (or the first point).
 */
export function nearestNeighbourOrder<T extends LatLng>(
  points: T[],
  start?: LatLng,
): T[] {
  if (points.length <= 1) return points.slice();
  const remaining = points.slice();
  const ordered: T[] = [];
  // Anchor on `start` if provided, otherwise on the first point (which is
  // consumed into the result so it becomes the chain's head).
  let cursor: LatLng;
  if (start) {
    cursor = start;
  } else {
    cursor = remaining.shift()!;
    ordered.push(cursor as T);
  }
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(cursor, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cursor = next;
  }
  return ordered;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
