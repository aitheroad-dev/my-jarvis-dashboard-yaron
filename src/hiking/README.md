# מתכנן הטיולים בישראל — Israel Hiking Planner

A fully public (no-auth), RTL Hebrew planner built over a curated list of points
of interest. This module replaces the dashboard as the app's entry point
(`src/App.tsx` → `HikingApp`).

## Features

- **Home** (`/`) — hero, AI-style chat planner, tag + region + text filters, POI grid.
- **POI detail** (`/poi/:id`) — description, OpenTopoMap map, tags, dated field notes (+ add).
- **Add / edit** (`/poi/new`, `/poi/:id/edit`) — name, description, region, lat/lng, fixed tags, image/Google links.
- **CSV import** (`/import`) — upload, column→field mapping, preview, import.

## Architecture

- `data/points.json` — 197 seed points imported from the source spreadsheet.
  Coordinates were validated against an Israel bounding box; 77 rows had lat/lng
  swapped and were auto-corrected, 34 had unrecoverable coordinates and carry
  `lat/lng = null` (shown in lists/detail, skipped on maps and in trip routes).
- `lib/store.ts` — seed + `localStorage` overlay (user edits, new points, field
  notes) exposed through `useSyncExternalStore` hooks. No backend; all public.
- `lib/chat.ts` — deterministic, client-side matcher. Parses tags / region /
  city from free text and returns a single best point or an ordered day-trip,
  **only** from the curated list. Swap in a real LLM here later if desired.
- `lib/taxonomy.ts` — fixed tags (with emoji + palette), regions, city gazetteer,
  example prompts.
- `components/MapView.tsx` — react-leaflet v5 + OpenTopoMap, custom trail-blaze pins.

## Design

Israel-trail palette (cream `#F2ECD8`, trail green `#4A7C4E`, mustard `#C8963E`,
sea blue `#2E6B8A`, earth `#8B5E3C`), topographic texture, blaze stripe motif,
"old map" card frames. Tokens live in `hiking.css`.
