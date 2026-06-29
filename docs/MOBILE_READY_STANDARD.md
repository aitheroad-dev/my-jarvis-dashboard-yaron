# Mobile + Desktop Page Standard

> **Every page in this dashboard must be usable on a 390px phone AND on desktop.**
> This is a hard gate: a page is not "done" until it has been seen at 390px width.
>
> Written 2026-06-29 after a mobile audit found the data-table pages (Goals,
> Projects, Move) rendered desktop columns that squeezed text into one-character-per-line
> ribbons on a phone. The patterns below are the fix, made permanent.

---

## The 6 rules (TL;DR)

1. **List pages → `SortableTable`.** It auto-renders rows as full-width stacked cards on mobile. Don't hand-roll a `<table>`.
2. **Custom rows/tables → `useIsMobile()` stacked-card branch.** Never ship a fixed multi-column grid as the *only* layout.
3. **Page padding + headings are fluid** — `clamp(...)` (or a `useIsMobile` ternary). Never a bare `padding: "40px 48px 80px"` / `fontSize: 34`.
4. **No fixed width > ~320px on any container; long text gets `overflowWrap: "anywhere"`.** No `minWidth` that exceeds a phone.
5. **KPI / summary cards reflow** — flex row with `flexWrap: "wrap"` and small `minWidth`.
6. **Verify at 390px before deploy.** Screenshot is the proof.

The breakpoint is **768px**: `import { useIsMobile } from "@/hooks/use-mobile"` → `const isMobile = useIsMobile()` is `true` below 768px.

---

## Pattern A — List pages (the common case)

Render every list page through the shared **`SortableTable`** (`src/components/atomic-crm/blueprint/SortableTable.tsx`). As of 2026-06-29 it detects mobile internally and renders each row as a **full-width stacked label/value card** instead of a table — so a list page built on it is mobile-ready *for free*.

```tsx
<SortableTable
  rows={rows}
  columns={COLUMNS}
  detailHref={(r) => `/things/${r.slug}`}
  defaultSort={{ key: "name", dir: "asc" }}
  emptyMessage="No things yet."
/>
```

**Do not** add your own `<table>` / `<thead>` / fixed `gridTemplateColumns` for list data — that is exactly what broke on mobile.

---

## Pattern B — Custom data rows (when SortableTable doesn't fit)

For bespoke rows (e.g. the Move task list), branch on `isMobile` and render a stacked card. Reference implementations: **`koop/KoopPage.tsx` → `DealRow`** and **`move/MovePage.tsx` → `TaskRow`**.

```tsx
function Row({ item, isMobile }: { item: Item; isMobile: boolean }) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px" }}>
        {/* status/lead control + TITLE on one row; title takes the width */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <StatusButton item={item} />
          <div style={{ flex: "1 1 auto", minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
            {item.title}
          </div>
        </div>
        {/* action buttons on their OWN row — never sharing the title's row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{/* …icons… */}</div>
        {/* meta fields stacked one per line, each full width */}
      </div>
    );
  }
  return <div style={{ display: "grid", gridTemplateColumns: DESKTOP_GRID }}>{/* …desktop… */}</div>;
}
```

Rules for the mobile branch:
- The **title gets the full card width** (`wordBreak: "break-word"`, `overflowWrap: "anywhere"`). Nothing wide sits beside it.
- **Action buttons go on their own wrapping row**, not in the title's row (that's what crushed the Move titles).
- **Hide the desktop header row** on mobile (`{!isMobile && <HeaderRow/>}`).
- Keep the desktop branch byte-identical to before — only *add* the mobile branch.

---

## Pattern C — Page chrome (padding + headings)

Make the outer padding and the page `<h1>` fluid so they shrink on a phone:

```tsx
// outer page wrapper
padding: "clamp(20px, 5vw, 40px) clamp(14px, 5vw, 48px) 80px",
// page heading
fontSize: "clamp(26px, 7vw, 34px)",
```

`clamp(min, preferred, max)` needs no hook and no media query. (The `useIsMobile` ternary `isMobile ? "20px 14px 60px" : "36px 44px 80px"` — koop style — is equally fine when you're already branching.)

---

## Pattern D — KPI / summary cards

Lay them out as a wrapping flex row so they go 3-up on desktop and 1–2-up on a phone:

```tsx
<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
  {/* each card: */}
  <div style={{ flex: "1 1 0", minWidth: 92 /* small! */ }}>…</div>
</div>
```

References: `koop/KoopPage.tsx` `SummaryCard`, `spend/SpendPage.tsx`.

---

## Anti-patterns (these caused the June 2026 mobile breakage)

- ❌ A fixed-column `<table>` / `gridTemplateColumns` as the **only** layout → columns clip and text wraps to slivers at 390px.
- ❌ `minWidth: 280` (or any value near/over a phone width) on cards in a row → horizontal overflow.
- ❌ Hardcoded `fontSize: 34` heading → cramped, oversized on a phone.
- ❌ Hardcoded `padding: "40px 48px 80px"` → only ~294px of usable width on a 390px screen.
- ❌ Relying on `overflow-x: auto` to "handle" a wide table — it technically scrolls but the right columns are off-screen and unreadable. Scrolling is not a mobile layout.

---

## Verification gate (mandatory before deploy)

Check **every new or changed page at 390px width** before `npm run deploy`. Any of:

1. **Chrome DevTools** device toolbar (⌘⇧M), pick iPhone / set width 390.
2. **Resize a real Chrome window to ~390px wide** — on desktop Chrome the window width *is* the layout viewport, so CSS breakpoints fire exactly like a phone.
3. **The audit method used in this repo** (scriptable, real authenticated Chrome):
   ```bash
   osascript -e 'tell application "Google Chrome"
     set bounds of front window to {120, 60, 510, 910}        # 390px wide
     set URL of active tab of front window to "https://my-jarvis-dashboard-yaron.pages.dev/<route>"
   end tell'
   screencapture -x -R120,60,390,850 page.png                  # honors real scroll
   ```

A page **passes** when, at 390px: no horizontal page scroll; no text wrapping to fewer than ~6 chars/line; every column/value readable; controls tappable; heading not oversized.

---

## New-page checklist (paste into the task / PR)

- [ ] List data renders through `SortableTable` (not a hand-rolled table)
- [ ] Any custom rows have a `useIsMobile` stacked-card branch; title full-width with `overflowWrap`
- [ ] Page padding + heading are fluid (`clamp()` or `useIsMobile`)
- [ ] No container has a fixed width > ~320px; long text has `overflowWrap: "anywhere"`
- [ ] KPI/summary cards use `flexWrap: "wrap"` + small `minWidth`
- [ ] Verified at 390px — screenshot attached

---

## Canonical references in this repo

| Concern | File |
|---|---|
| Mobile breakpoint hook | `src/hooks/use-mobile.ts` (`useIsMobile`, 768px) |
| List-page mobile cards | `src/components/atomic-crm/blueprint/SortableTable.tsx` |
| Custom row mobile pattern | `src/components/atomic-crm/koop/KoopPage.tsx` (`DealRow`), `src/components/atomic-crm/move/MovePage.tsx` (`TaskRow`) |
| KPI card reflow | `src/components/atomic-crm/spend/SpendPage.tsx`, koop `SummaryCard` |
| Fluid page chrome | `src/components/atomic-crm/goals/GoalsListPage.tsx` |

> **Future hardening (not yet built):** a shared `<PageShell>` that owns the fluid
> padding + centered header would let new pages get Pattern C for free, the same way
> `SortableTable` gives Pattern A for free. Until then, copy the `clamp()` values above.
