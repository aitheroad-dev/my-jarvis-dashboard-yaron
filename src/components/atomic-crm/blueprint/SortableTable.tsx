// SortableTable.tsx — MJOS-043
//
// The shared list-page component. Locked architecture (myjarvis-dashboard
// skill, "Page architecture doctrine"): every list page renders through
// THIS component. It guarantees the binding contract between a structured
// list page and its KB-style detail page — the entire row is clickable
// and navigates to `detailHref(row)`.
//
// Why this exists: previously each list page hand-rolled its table and
// the `<Link>` lived on the name cell only. Clicking elsewhere on a row
// did nothing, breaking the implicit "click a row to open it" contract.
// One shared component = impossible to forget.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "./ArchitectureBlocks";

export type SortDir = "asc" | "desc";

export type ColumnDef<R> = {
  /** Stable key for sorting. Use a `keyof R` for column-backed values; use any
   * string for synthetic columns whose values come from `render`. */
  key: string;
  label: string;
  /** CSS width (e.g. "120px"). Optional. */
  width?: string;
  /** Custom cell renderer. If absent, the raw value at `row[key]` is rendered as text. */
  render?: (row: R) => React.ReactNode;
  /** If false, header is not clickable and column does not participate in sort. Default true. */
  sortable?: boolean;
  /** Override value used for sort comparisons. Default: `row[key]`. */
  sortValue?: (row: R) => string | number | null | undefined;
};

type Props<R> = {
  rows: R[];
  columns: ColumnDef<R>[];
  /** href to navigate to when the row is clicked. */
  detailHref: (row: R) => string;
  /** Stable key for each row (React key + sort tiebreaker). Default: `row.slug` or `row.id`. */
  rowKey?: (row: R) => string;
  /** Initial sort. If omitted, no sort is applied. */
  defaultSort?: { key: string; dir: SortDir };
  /** Shown when `rows` is empty. */
  emptyMessage?: string;
};

export function SortableTable<R extends Record<string, unknown>>({
  rows, columns, detailHref, rowKey, defaultSort, emptyMessage = "No rows.",
}: Props<R>) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "asc");

  const getKey = rowKey ?? ((r: R) => String(r.slug ?? r.id ?? ""));

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    const valueFn = col?.sortValue ?? ((r: R) => r[sortKey] as string | number | null | undefined);
    const out = [...rows];
    out.sort((a, b) => {
      const av = valueFn(a);
      const bv = valueFn(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, columns, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  if (rows.length === 0) {
    return (
      <div style={{
        padding: "20px 22px", fontSize: 14, color: T.ink3, fontStyle: "italic",
        background: T.white, border: `1px solid ${T.line}`, borderRadius: 12,
      }}>
        {emptyMessage}
      </div>
    );
  }

  // Mobile (≤767px): a table with desktop columns squeezes cells into unreadable
  // slivers. Render each row as a stacked card instead — every column gets a full-
  // width label/value block, so long text (descriptions, RTL Hebrew) wraps normally.
  // The whole card stays clickable → detail page, matching the desktop row contract.
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sortedRows.map(row => {
          const href = detailHref(row);
          return (
            <div
              key={getKey(row)}
              onClick={() => navigate(href)}
              style={{
                cursor: "pointer",
                background: T.white,
                border: `1px solid ${T.line}`,
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {columns.map(col => (
                <div key={col.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em", color: T.skyDark,
                  }}>
                    {col.label}
                  </span>
                  <div style={{
                    fontSize: 14, color: T.ink, lineHeight: 1.5,
                    wordBreak: "break-word", overflowWrap: "anywhere",
                  }}>
                    {col.render ? col.render(row) : ((row[col.key] as React.ReactNode) ?? "—")}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{
      overflowX: "auto", borderRadius: 10,
      border: `1px solid ${T.line}`,
    }}>
      <table style={{
        width: "100%", borderCollapse: "collapse",
        fontSize: 14, background: T.white,
      }}>
        <thead>
          <tr>
            {columns.map(col => {
              const sortable = col.sortable !== false;
              const active = sortable && sortKey === col.key;
              return (
                <th
                  key={col.key}
                  onClick={sortable ? () => toggleSort(col.key) : undefined}
                  style={{
                    background: T.bg2, color: T.skyDark,
                    fontWeight: 700, fontSize: 11, textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "12px 16px", textAlign: "left",
                    borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap",
                    cursor: sortable ? "pointer" : "default",
                    userSelect: "none",
                    width: col.width,
                  }}
                >
                  {col.label}
                  {active ? (
                    <span style={{ marginLeft: 6, color: T.skyDark }}>
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  ) : sortable ? (
                    <span style={{ marginLeft: 6, color: T.ink3, opacity: 0.4 }}>↕</span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => {
            const href = detailHref(row);
            return (
              <tr
                key={getKey(row)}
                onClick={() => navigate(href)}
                style={{
                  cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.skySoft; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.white; }}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{
                      padding: "12px 16px",
                      verticalAlign: "middle", color: T.ink,
                      lineHeight: 1.5, borderTop: `1px solid ${T.line}`,
                    }}
                  >
                    {col.render ? col.render(row) : (row[col.key] as React.ReactNode ?? "—")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Helper — keyboard-accessible link styled with the architectureT accent palette.
 * Use inside a column's `render` for the "name" cell so users can also tab to the row. */
export function RowLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      onClick={(e) => e.stopPropagation()}
      style={{
        color: T.accent, fontWeight: 600, textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
