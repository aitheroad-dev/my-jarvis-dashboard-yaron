// Data layer for the planner.
//
// The app is fully public (no auth), so user contributions — new/edited points
// and field notes — live in localStorage layered on top of the bundled seed
// (197 curated points imported from the source spreadsheet). React components
// subscribe through `useSyncExternalStore`, so any write re-renders the UI.

import { useSyncExternalStore } from "react";
import seedRaw from "../data/points.json";
import type { FieldNote, PointOfInterest } from "./types";

const OVERRIDES_KEY = "hiking:points:v1";
const NOTES_KEY = "hiking:notes:v1";

const SEED: PointOfInterest[] = (seedRaw as Array<Omit<PointOfInterest, "createdDate">>).map(
  (p) => ({ ...p, createdDate: "2024-01-01T00:00:00.000Z" }),
);

// ---- subscription plumbing -------------------------------------------------

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---- localStorage helpers --------------------------------------------------

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("hiking store: failed to persist", err);
  }
}

// Caches recomputed on every write so `getSnapshot` returns a stable reference
// (required by useSyncExternalStore to avoid render loops).
let pointsCache: PointOfInterest[] | null = null;
let notesCache: Record<string, FieldNote[]> | null = null;

function overrides(): Record<string, PointOfInterest> {
  return readJson<Record<string, PointOfInterest>>(OVERRIDES_KEY, {});
}

function computePoints(): PointOfInterest[] {
  const ov = overrides();
  const merged: PointOfInterest[] = SEED.map((p) => ov[p.id] ?? p);
  const seedIds = new Set(SEED.map((p) => p.id));
  for (const [id, p] of Object.entries(ov)) {
    if (!seedIds.has(id)) merged.push(p);
  }
  merged.sort((a, b) => a.createdDate.localeCompare(b.createdDate));
  return merged;
}

// ---- public read API -------------------------------------------------------

export function getAllPoints(): PointOfInterest[] {
  if (!pointsCache) pointsCache = computePoints();
  return pointsCache;
}

export function getPoint(id: string): PointOfInterest | undefined {
  return getAllPoints().find((p) => p.id === id);
}

function getNotesMap(): Record<string, FieldNote[]> {
  if (!notesCache) notesCache = readJson<Record<string, FieldNote[]>>(NOTES_KEY, {});
  return notesCache;
}

export function getNotes(poiId: string): FieldNote[] {
  const list = getNotesMap()[poiId] ?? [];
  // newest observation date first
  return [...list].sort((a, b) => b.date.localeCompare(a.date));
}

// ---- public write API ------------------------------------------------------

export function upsertPoint(
  input: Omit<PointOfInterest, "id" | "createdDate"> & { id?: string },
): PointOfInterest {
  const ov = overrides();
  const id = input.id ?? `user-${Date.now()}`;
  const existing = getPoint(id);
  const point: PointOfInterest = {
    ...input,
    id,
    createdDate: existing?.createdDate ?? new Date().toISOString(),
  };
  ov[id] = point;
  writeJson(OVERRIDES_KEY, ov);
  pointsCache = null;
  emit();
  return point;
}

export function importPoints(
  rows: Array<Omit<PointOfInterest, "id" | "createdDate">>,
): number {
  const ov = overrides();
  let n = 0;
  rows.forEach((row, i) => {
    const id = `import-${Date.now()}-${i}`;
    ov[id] = { ...row, id, createdDate: new Date(Date.now() + i).toISOString() };
    n++;
  });
  writeJson(OVERRIDES_KEY, ov);
  pointsCache = null;
  emit();
  return n;
}

export function addNote(poiId: string, text: string, date: string): FieldNote {
  const map = getNotesMap();
  const note: FieldNote = {
    id: `note-${Date.now()}`,
    pointOfInterestId: poiId,
    text,
    date,
    createdDate: new Date().toISOString(),
  };
  map[poiId] = [...(map[poiId] ?? []), note];
  writeJson(NOTES_KEY, map);
  notesCache = null;
  emit();
  return note;
}

// ---- React hooks -----------------------------------------------------------

export function usePoints(): PointOfInterest[] {
  return useSyncExternalStore(subscribe, getAllPoints, getAllPoints);
}

export function usePoint(id: string | undefined): PointOfInterest | undefined {
  const points = usePoints();
  return id ? points.find((p) => p.id === id) : undefined;
}

export function useNotes(poiId: string): FieldNote[] {
  return useSyncExternalStore(
    subscribe,
    () => getNotesMap()[poiId] ?? EMPTY_NOTES,
    () => getNotesMap()[poiId] ?? EMPTY_NOTES,
  );
}

const EMPTY_NOTES: FieldNote[] = [];
