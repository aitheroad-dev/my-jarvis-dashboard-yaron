// Heuristic, fully client-side "AI" for the free-text chat box.
//
// It never invents places: it parses the request for tags, a region and/or a
// city, then ranks and returns matches drawn ONLY from the curated point list.
// Depending on the request it returns either a single best point or an ordered
// multi-stop day trip with a route.

import { CITIES, REGIONS, TAGS } from "./taxonomy";
import { distanceKm, nearestNeighbourOrder } from "./geo";
import type { PointOfInterest } from "./types";

export interface ChatResult {
  kind: "single" | "trip" | "none";
  message: string;
  /** For "single": [best, ...alternatives]. For "trip": the ordered route. */
  points: PointOfInterest[];
  /** City the request was anchored to, if any. */
  anchor?: { name: string; lat: number; lng: number };
}

const TRIP_TRIGGERS = [
  "טיול יום",
  "יום טיול",
  "יום שלם",
  "סופ\"ש",
  "סופש",
  "סוף שבוע",
  "תבנה",
  "בנה לי",
  "תכנן",
  "תכנון",
  "כמה נקודות",
  "מסלול יום",
  "יומיים",
];

function normalize(s: string): string {
  return s.replace(/["'״׳]/g, '"').toLowerCase();
}

function detectTags(text: string): string[] {
  const found: string[] = [];
  for (const tag of TAGS) {
    const hit = [tag.label, ...tag.synonyms].some((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (hit) found.push(tag.label);
  }
  return found;
}

function detectRegion(text: string): string | undefined {
  return REGIONS.find((r) => text.includes(r) || text.includes(r.replace("ה", "")));
}

function detectCity(text: string): (typeof CITIES)[number] | undefined {
  for (const city of CITIES) {
    if (text.includes(city.name)) return city;
    if (city.aliases?.some((a) => text.includes(a))) return city;
  }
  return undefined;
}

function isTrip(text: string): boolean {
  if (TRIP_TRIGGERS.some((t) => text.includes(normalize(t)))) return true;
  // "טיול" + "יום" anywhere also implies a full day plan
  return text.includes("טיול") && text.includes("יום");
}

export function runChat(query: string, points: PointOfInterest[]): ChatResult {
  const text = normalize(query.trim());
  if (!text) {
    return { kind: "none", message: "כתבו לי מה בא לכם — מעיין, תצפית, חניון לילה או טיול יום שלם.", points: [] };
  }

  const tags = detectTags(text);
  const region = detectRegion(text);
  const city = detectCity(text);
  const trip = isTrip(text);

  // Filter by detected tags (a point qualifies if it carries any detected tag)
  // and region. If nothing was detected we keep the whole list and just rank.
  let candidates = points.filter((p) => {
    if (tags.length && !p.tags.some((t) => tags.includes(t))) return false;
    if (region && p.region !== region) return false;
    return true;
  });

  if (!candidates.length) {
    return {
      kind: "none",
      message: "לא מצאתי במאגר נקודה שמתאימה לבקשה. נסו לנסח אחרת — למשל \"מעיין בגליל\" או \"תצפית שקיעה בנגב\".",
      points: [],
    };
  }

  const anchor = city ? { name: city.name, lat: city.lat, lng: city.lng } : undefined;

  // Rank: by distance to the anchor city when given, otherwise points that have
  // a description / are mappable float up a little, then original order.
  const mappable = candidates.filter((p) => p.lat != null && p.lng != null);
  if (anchor) {
    const ranked = mappable
      .map((p) => ({ p, d: distanceKm(anchor, { lat: p.lat!, lng: p.lng! }) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.p);
    // points without coords still belong to the result set, appended last
    candidates = [...ranked, ...candidates.filter((p) => p.lat == null)];
  }

  const summary = describe(tags, region, anchor?.name);

  if (trip) {
    const picks = candidates
      .filter((p) => p.lat != null && p.lng != null)
      .slice(0, 6);
    const route = nearestNeighbourOrder(
      picks.map((p) => ({ ...p, lat: p.lat as number, lng: p.lng as number })),
      anchor,
    ).slice(0, 5) as PointOfInterest[];
    if (!route.length) {
      return { kind: "none", message: "מצאתי נקודות מתאימות אך ללא מיקום על המפה לבניית מסלול. נסו אזור אחר.", points: [] };
    }
    return {
      kind: "trip",
      message: `הנה הצעה ליום טיול${summary} — ${route.length} תחנות לפי סדר נוח על המפה:`,
      points: route,
      anchor,
    };
  }

  const best = candidates[0];
  const alternatives = candidates.slice(1, 4);
  return {
    kind: "single",
    message: `הנקודה שהכי מתאימה${summary}: ${best.name}.${
      alternatives.length ? " הוספתי גם כמה חלופות." : ""
    }`,
    points: [best, ...alternatives],
    anchor,
  };
}

function describe(tags: string[], region?: string, city?: string): string {
  const parts: string[] = [];
  if (tags.length) parts.push(tags.join(", "));
  if (city) parts.push(`ליד ${city}`);
  else if (region) parts.push(`ב${region}`);
  return parts.length ? ` (${parts.join(" · ")})` : "";
}
