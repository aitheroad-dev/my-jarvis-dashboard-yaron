// TicketsKanbanPage.tsx
// /tickets surface — replaces the stacked-card TicketsListPage with a 5-column
// Kanban view. Drag a card between columns → PUT /api/tickets/:slug { status }.
// Sky-blue palette (mirrors DashboardArchitecturePage's inline T tokens — page
// identity stays sky-blue, distinct from cream/peach editorial pages).
// Heartbeat preserved: pulsing emerald dot when in_progress, 5s auto-refresh,
// log tail under title, click-into-card opens /tickets/:slug detail.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Ticket as TicketIcon } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useApi } from "@/lib/api";

// ── Sky-blue palette (mirrors DashboardArchitecturePage T tokens) ─────────
const T = {
  bg: "#F2F7FD",
  bg2: "#E5EEF9",
  ink: "#1C1917",
  ink2: "#57534E",
  ink3: "#A8A29E",
  sky: "#7AB4F4",
  skyDark: "#3B82C8",
  skySoft: "#D2E4FC",
  line: "#D0DEF0",
  accent: "#2A6AAC",
  green: "#2A7A4B",
  greenSoft: "#E8F3EC",
  amber: "#B87333",
  amberSoft: "#FCEFD9",
  plum: "#8E4585",
  plumSoft: "#F3E6F2",
  white: "#FFFFFF",
  red: "#C0392B",
  redSoft: "#FDECEA",
};

type Status = "todo" | "in_progress" | "review" | "done" | "archived";

type TicketRow = {
  id: string;
  slug: string;
  project_id: string | null;
  project_name: string | null;
  goal_id: string | null;
  goal_title: string | null;
  agent: string | null;
  title: string;
  status: Status;
  current_step: string | null;
  progress: string | null;
  source: "pai" | "manual" | null;
  log: string | null;
  created_at: string;
  updated_at: string;
};

// 5-second poll cadence — fast enough to feel live, slow enough to be free.
const REFRESH_MS = 5_000;

// Archived is intentionally omitted — archived tickets leave the board.
// Done is capped (see DONE_VISIBLE_LIMIT) so it doesn't grow unbounded.
const COLUMN_ORDER: Status[] = ["todo", "in_progress", "review", "done"];

// Show at most this many Done cards per swimlane (most-recently-updated first);
// the rest collapse into a "+N more" footer so each project lane stays short.
const DONE_VISIBLE_LIMIT = 6;

const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

// Column header tints — sky-blue family + status-tinted accents.
const COLUMN_HEADER_BG: Record<Status, string> = {
  todo: T.bg2,
  in_progress: T.skySoft,
  review: T.amberSoft,
  done: T.greenSoft,
  archived: T.line,
};

const COLUMN_HEADER_FG: Record<Status, string> = {
  todo: T.ink2,
  in_progress: T.skyDark,
  review: T.amber,
  done: T.green,
  archived: T.ink3,
};

// Card left-edge accent — subtle status mark.
const CARD_ACCENT: Record<Status, string> = {
  todo: T.ink3,
  in_progress: T.skyDark,
  review: T.amber,
  done: T.green,
  archived: T.line,
};

// Persona colors — sky-tinted variants where natural; existing pitch-deck
// hues otherwise.
// The four PAI personas: jarvis (blue), atlas (green), nova (plum), rex (amber).
const AGENT_COLOR: Record<string, string> = {
  jarvis: T.skyDark,
  atlas: T.green,
  nova: T.plum,
  rex: T.amber,
};

function lastLogLine(log: string | null): string | null {
  if (!log) return null;
  const lines = log
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1];
}

function MetaDot() {
  return (
    <span
      style={{
        color: T.ink3,
        fontSize: 12,
        userSelect: "none",
      }}
    >
      ·
    </span>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

function CardBody({
  t,
  isDragging,
}: {
  t: TicketRow;
  isDragging?: boolean;
}) {
  const isLive = t.status === "in_progress";
  const tail = lastLogLine(t.log);
  const agentColor = t.agent ? AGENT_COLOR[t.agent] ?? T.ink2 : T.ink3;

  return (
    <div
      style={{
        background: T.white,
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${CARD_ACCENT[t.status]}`,
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: isDragging
          ? "0 8px 24px rgba(28,25,23,0.15)"
          : "0 1px 2px rgba(28,25,23,0.04)",
        opacity: isDragging ? 0.95 : 1,
        transition: "box-shadow 120ms ease, border-color 120ms ease",
      }}
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          minWidth: 0,
          marginBottom: 8,
        }}
      >
        {isLive && (
          <span
            className="animate-pulse"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: T.green,
              flexShrink: 0,
              marginTop: 7,
            }}
            aria-label="in progress"
            title="In progress — live heartbeat"
          />
        )}
        <h3
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: T.ink,
            margin: 0,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
            minWidth: 0,
            flex: 1,
          }}
          title={t.title}
        >
          {t.title}
        </h3>
      </div>

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          fontFamily: "Inter, sans-serif",
          fontSize: 11,
          color: T.ink2,
          lineHeight: 1.5,
        }}
      >
        <code
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 10,
            color: T.skyDark,
            background: T.skySoft,
            padding: "1px 6px",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          {t.slug}
        </code>

        {t.agent ? (
          <>
            <MetaDot />
            <span
              style={{
                color: agentColor,
                fontWeight: 600,
                textTransform: "lowercase",
              }}
            >
              @{t.agent}
            </span>
          </>
        ) : null}

        {t.current_step ? (
          <>
            <MetaDot />
            <span
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 10,
                color: isLive ? T.skyDark : T.ink3,
                fontWeight: isLive ? 600 : 400,
              }}
            >
              {t.current_step}
            </span>
          </>
        ) : null}

        {t.progress ? (
          <>
            <MetaDot />
            <span
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 10,
                color: T.ink2,
                fontWeight: 600,
              }}
              title={`${t.progress} criteria met`}
            >
              {t.progress}
            </span>
          </>
        ) : null}
      </div>

      {/* Log tail */}
      {tail ? (
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "Inter, sans-serif",
            fontSize: 11,
            color: T.ink3,
            lineHeight: 1.45,
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={tail}
        >
          {tail}
        </p>
      ) : null}
    </div>
  );
}

function DraggableCard({
  t,
  onOpen,
}: {
  t: TicketRow;
  onOpen: (slug: string) => void;
}) {
  // PAI-owned tickets are phase-driven: status mirrors the live ISA, so a manual
  // drag would be silently overwritten on the next sync. Lock drag for
  // source='pai'; manual cards stay draggable. Both stay click-to-open.
  const draggable = t.source !== "pai";
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useDraggable({ id: t.id, data: { ticket: t }, disabled: !draggable });

  // dnd-kit ships a `transform` we apply only when actively dragging — the
  // DragOverlay handles the floating preview, so we just hide the in-place
  // card with opacity while it's being dragged.
  const style: React.CSSProperties = {
    cursor: draggable ? (isDragging ? "grabbing" : "grab") : "pointer",
    opacity: isDragging ? 0.4 : 1,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    marginBottom: 8,
    touchAction: draggable ? "none" : undefined,
  };

  const dragHandlers = draggable ? { ...listeners, ...attributes } : {};

  // Click-to-detail vs drag — PointerSensor's distance:5 activationConstraint
  // (configured at the DndContext level) decides; if the pointer moves >5px
  // before mouseup, dnd-kit takes over and onClick never fires.
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragHandlers}
      onClick={() => onOpen(t.slug)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(t.slug);
        }
      }}
      aria-label={`Open ${t.slug}`}
      title={
        draggable ? undefined : "Status follows the ISA phase — not draggable"
      }
    >
      <CardBody t={t} />
    </div>
  );
}

// ── Column ──────────────────────────────────────────────────────────────────

function Column({
  status,
  droppableId,
  tickets,
  onOpen,
  limit,
}: {
  status: Status;
  droppableId: string;
  tickets: TicketRow[];
  onOpen: (slug: string) => void;
  limit?: number;
}) {
  // Droppable id is unique per (swimlane, status) so columns in different
  // project lanes never collide; the status itself rides in `data`.
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { status },
  });

  // Cap the rendered cards (most-recent first, already sorted by the API);
  // the overflow collapses into a "+N more" footer so the column stays short.
  const visible =
    limit && tickets.length > limit ? tickets.slice(0, limit) : tickets;
  const hiddenCount = tickets.length - visible.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0",
        minWidth: 300,
        maxWidth: 360,
      }}
    >
      {/* Column header */}
      <div
        style={{
          padding: "10px 12px",
          background: COLUMN_HEADER_BG[status],
          borderRadius: "8px 8px 0 0",
          border: `1px solid ${T.line}`,
          borderBottom: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: COLUMN_HEADER_FG[status],
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {STATUS_LABEL[status]}
        </span>
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 11,
            color: COLUMN_HEADER_FG[status],
            fontWeight: 600,
            background: T.white,
            padding: "1px 8px",
            borderRadius: 10,
            minWidth: 22,
            textAlign: "center",
          }}
        >
          {tickets.length}
        </span>
      </div>

      {/* Drop zone body */}
      <div
        ref={setNodeRef}
        style={{
          background: isOver ? T.skySoft : T.bg,
          border: isOver
            ? `1px dashed ${T.skyDark}`
            : `1px solid ${T.line}`,
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          padding: 10,
          minHeight: 280,
          flex: 1,
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        {tickets.length === 0 ? (
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              color: T.ink3,
              fontStyle: "italic",
              textAlign: "center",
              margin: "20px 0",
            }}
          >
            empty
          </p>
        ) : (
          <>
            {visible.map((t) => (
              <DraggableCard key={t.id} t={t} onOpen={onOpen} />
            ))}
            {hiddenCount > 0 ? (
              <p
                style={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 11,
                  color: T.ink3,
                  textAlign: "center",
                  margin: "8px 0 2px",
                }}
              >
                +{hiddenCount} more
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ── Swimlanes ─────────────────────────────────────────────────────────────────
// Project-first board: each project is a horizontal swimlane holding the 4
// status columns. Tickets with no project_id collapse into a "Standalone" lane,
// always rendered last. Containers (kind:project) never reach here — the sync
// excludes them, so a project shows only its child work efforts.

type Swimlane = {
  key: string;
  name: string;
  tickets: TicketRow[];
  byStatus: Record<Status, TicketRow[]>;
};

const STANDALONE_KEY = "__standalone__";

function buildSwimlanes(rows: TicketRow[]): Swimlane[] {
  const map = new Map<string, Swimlane>();
  for (const r of rows) {
    const key = r.project_id ?? STANDALONE_KEY;
    const name = r.project_name ?? "Standalone";
    let lane = map.get(key);
    if (!lane) {
      lane = {
        key,
        name,
        tickets: [],
        byStatus: { todo: [], in_progress: [], review: [], done: [], archived: [] },
      };
      map.set(key, lane);
    }
    lane.tickets.push(r);
    lane.byStatus[r.status]?.push(r);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === STANDALONE_KEY) return 1;
    if (b.key === STANDALONE_KEY) return -1;
    return a.name.localeCompare(b.name);
  });
}

// ── Page ────────────────────────────────────────────────────────────────────

export function TicketsKanbanPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Manual To-Do composer state.
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Pending optimistic moves — { ticketId: status }. While a PUT is in flight,
  // the polling response is merged through this map so the optimistic state
  // doesn't flicker back. Cleared per-id when PUT resolves.
  const pendingMoves = useRef<Map<string, Status>>(new Map());
  const isDraggingRef = useRef(false);

  // Pointer sensor with 5px activation distance — small movement is a click
  // (opens detail), >5px is a drag. Standard dnd-kit pattern.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      // Don't clobber state mid-drag.
      if (isDraggingRef.current) return;
      try {
        const res = await api("/api/tickets");
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as TicketRow[];
        if (cancelled) return;
        // Merge: any pending optimistic move wins until its PUT resolves.
        const merged = data.map((row) => {
          const pending = pendingMoves.current.get(row.id);
          return pending ? { ...row, status: pending } : row;
        });
        setRows(merged);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void fetchOnce();
    const intervalId = window.setInterval(fetchOnce, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = (slug: string) => {
    if (isDraggingRef.current) return;
    navigate(`/tickets/${slug}`);
  };

  // Create a manual To-Do (source='manual' — the sync never touches it). Slug
  // is derived from the title plus a short suffix to stay unique. Optimistically
  // prepended; the 5s poll reconciles with the server row.
  const createTodo = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "todo";
    const slug = `${base}-${Date.now().toString(36).slice(-4)}`;
    try {
      const res = await api("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, status: "todo" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as { id: string; slug: string };
      const now = new Date().toISOString();
      setRows((cur) => [
        {
          id: created.id,
          slug: created.slug,
          project_id: null,
          project_name: null,
          goal_id: null,
          goal_title: null,
          agent: null,
          title,
          status: "todo",
          current_step: null,
          progress: null,
          source: "manual",
          log: null,
          created_at: now,
          updated_at: now,
        },
        ...(cur ?? []),
      ]);
      setNewTitle("");
      setComposing(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? `Create failed: ${err.message}` : "Create failed",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    isDraggingRef.current = true;
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    isDraggingRef.current = false;
    setActiveId(null);

    const { active, over } = event;
    if (!over || !rows) return;

    const ticketId = String(active.id);
    const overData = over.data.current as { status?: Status } | undefined;
    const newStatus = overData?.status;
    if (!newStatus) return;

    const ticket = rows.find((r) => r.id === ticketId);
    if (!ticket) return;
    if (ticket.status === newStatus) return;

    const prevStatus = ticket.status;
    // Optimistic: flip locally, register pending, fire PUT.
    pendingMoves.current.set(ticketId, newStatus);
    setRows((cur) =>
      cur
        ? cur.map((r) => (r.id === ticketId ? { ...r, status: newStatus } : r))
        : cur,
    );

    try {
      const res = await api(`/api/tickets/${ticket.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      pendingMoves.current.delete(ticketId);
    } catch (err) {
      // Revert.
      pendingMoves.current.delete(ticketId);
      setRows((cur) =>
        cur
          ? cur.map((r) =>
              r.id === ticketId ? { ...r, status: prevStatus } : r,
            )
          : cur,
      );
      setError(
        err instanceof Error
          ? `Move failed: ${err.message}`
          : "Move failed",
      );
    }
  };

  const inProgressCount =
    rows?.filter((t) => t.status === "in_progress").length ?? 0;

  const swimlanes = rows ? buildSwimlanes(rows) : [];

  const activeTicket = activeId
    ? rows?.find((r) => r.id === activeId) ?? null
    : null;

  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        padding: "24px 32px 80px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: T.skyDark,
              textTransform: "uppercase",
              margin: "0 0 6px 0",
            }}
          >
            R&amp;D · live
          </p>
          <h1
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 26,
              fontWeight: 700,
              color: T.ink,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Tickets
          </h1>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              color: T.ink2,
              margin: "6px 0 0",
              lineHeight: 1.55,
              maxWidth: 640,
            }}
          >
            Grouped by project. Drag a card between columns to change status.
            Auto-refreshes every {Math.round(REFRESH_MS / 1000)}s.
          </p>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
          }}
        >
          {rows && (
            <>
              {inProgressCount > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: T.green,
                    fontWeight: 600,
                  }}
                >
                  <span
                    className="animate-pulse"
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: T.green,
                    }}
                  />
                  {inProgressCount} live
                </span>
              )}
              <span style={{ color: T.ink3 }}>
                {rows.length} ticket{rows.length === 1 ? "" : "s"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setComposing((c) => !c)}
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              color: T.white,
              background: T.skyDark,
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            + To-Do
          </button>
        </div>
      </div>

      {/* Manual To-Do composer */}
      {composing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            padding: "10px 12px",
            background: T.white,
            border: `1px solid ${T.line}`,
            borderRadius: 10,
          }}
        >
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createTodo();
              if (e.key === "Escape") {
                setComposing(false);
                setNewTitle("");
              }
            }}
            placeholder="New to-do — title…"
            style={{
              flex: 1,
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              color: T.ink,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              padding: "8px 10px",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => void createTodo()}
            disabled={creating || !newTitle.trim()}
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              color: T.white,
              background:
                creating || !newTitle.trim() ? T.ink3 : T.skyDark,
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              cursor:
                creating || !newTitle.trim() ? "not-allowed" : "pointer",
            }}
          >
            {creating ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setComposing(false);
              setNewTitle("");
            }}
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              color: T.ink2,
              background: "transparent",
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "12px 16px",
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 10,
            color: T.red,
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <AlertCircle
            style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
          />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {!error && rows === null && (
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            color: T.ink3,
          }}
        >
          Loading…
        </p>
      )}

      {/* Empty */}
      {rows && rows.length === 0 && (
        <div
          style={{
            background: T.white,
            border: `1px solid ${T.line}`,
            borderRadius: 10,
            textAlign: "center",
            padding: "32px 24px",
          }}
        >
          <TicketIcon
            style={{
              width: 32,
              height: 32,
              color: T.ink3,
              margin: "0 auto 8px",
            }}
          />
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: T.ink,
              margin: 0,
            }}
          >
            No tickets yet
          </p>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              color: T.ink3,
              margin: "4px 0 0",
              lineHeight: 1.5,
            }}
          >
            An R&amp;D agent creates a ticket for each unit of work.
          </p>
        </div>
      )}

      {/* Kanban board */}
      {rows && rows.length > 0 && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            isDraggingRef.current = false;
            setActiveId(null);
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 28,
            }}
          >
            {swimlanes.map((lane) => {
              const doneCount = lane.byStatus.done.length;
              const activeCount = lane.tickets.length - doneCount;
              return (
                <div key={lane.key}>
                  {/* Swimlane header — project name + rollup */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      marginBottom: 10,
                      paddingBottom: 6,
                      borderBottom: `2px solid ${T.line}`,
                    }}
                  >
                    <h2
                      style={{
                        fontFamily: "Inter, sans-serif",
                        fontSize: 16,
                        fontWeight: 700,
                        color: lane.key === STANDALONE_KEY ? T.ink2 : T.ink,
                        margin: 0,
                      }}
                    >
                      {lane.name}
                    </h2>
                    <span
                      style={{
                        fontFamily: "Inter, sans-serif",
                        fontSize: 12,
                        color: T.ink3,
                        fontWeight: 600,
                      }}
                    >
                      {doneCount} done · {activeCount} active
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "stretch",
                      overflowX: "auto",
                      paddingBottom: 8,
                    }}
                  >
                    {COLUMN_ORDER.map((status) => (
                      <Column
                        key={status}
                        status={status}
                        droppableId={`${lane.key}:${status}`}
                        tickets={lane.byStatus[status]}
                        onOpen={handleOpen}
                        limit={status === "done" ? DONE_VISIBLE_LIMIT : undefined}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeTicket ? (
              <div style={{ width: 320, transform: "rotate(2deg)" }}>
                <CardBody t={activeTicket} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

(TicketsKanbanPage as unknown as { path: string }).path = "/tickets";
