import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  Loader2,
  Plus,
  SendHorizontal,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

type MoveBucket = "A" | "B" | "C" | "D";
type MoveStatus = "todo" | "doing" | "done";

type BuyOption = { label: string; url: string; price?: string | null };

type MoveTask = {
  id: string;
  bucket: MoveBucket;
  seq: number;
  title: string;
  owner: string | null;
  due: string | null;
  status: MoveStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  buy_options: BuyOption[] | null;
};

type EditableField = "title" | "owner" | "due" | "notes";

type EditingCell = {
  id: string;
  field: EditableField;
  value: string;
};

// Fields a single PATCH may carry (plus base_version, added at call time).
type TaskPatch = Partial<Pick<MoveTask, "title" | "owner" | "due" | "notes" | "status" | "bucket">> & {
  buy_options?: BuyOption[] | null;
};

// Poll the shared list this often so a co-editor's changes appear without a reload.
const POLL_MS = 5000;

// Bucket keys (A–D) are the stored data; titles are Hebrew display labels
// (kept in sync with the move-share page).
const BUCKETS: { id: MoveBucket; title: string }[] = [
  { id: "A", title: "מסירת הבית (קלוסטרהוף)" },
  { id: "B", title: "תשתיות וכתובת" },
  { id: "C", title: "הבית החדש" },
  { id: "D", title: "אריזה ולוגיסטיקה" },
];

// Owner is stored as the Hebrew label directly; "" in the <select> means unassigned (null).
const OWNER_OPTIONS = ["ירון", "נועה", "שנינו"] as const;
const OWNER_NONE_LABEL = "ללא";

// Buy-item accent — distinct from the status palette (gray/amber/green).
const BUY_ACCENT = "#7C3AED";
const BUY_ACCENT_SOFT = "#F3E8FF";

const MAX_BUY_OPTIONS = 4;

const NEXT_STATUS: Record<MoveStatus, MoveStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

// Status VALUES stay English in the DB; this maps them to Hebrew for display.
const STATUS_HE: Record<MoveStatus, string> = {
  todo: "לעשות",
  doing: "בתהליך",
  done: "בוצע",
};

const STATUS_ICON: Record<MoveStatus, typeof Circle> = {
  todo: Circle,
  doing: CircleDot,
  done: CheckCircle2,
};

const STATUS_TONE: Record<MoveStatus, { fg: string; bg: string; bd: string }> = {
  todo: { fg: T.ink3, bg: T.white, bd: T.line },
  doing: { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  done: { fg: T.green, bg: T.greenSoft, bd: T.green },
};

// Shared desktop grid: status | title | owner | due | notes | actions.
const DESKTOP_GRID =
  "34px minmax(180px, 1.6fr) minmax(96px, 0.55fr) minmax(64px, 0.4fr) minmax(130px, 0.85fr) auto";

function isBuyItem(task: MoveTask): boolean {
  return Array.isArray(task.buy_options) && task.buy_options.length > 0;
}

function displayText(value: string | null): string {
  return value?.trim() ? value : "—";
}

function normalizeEdit(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function textForField(task: MoveTask, field: EditableField): string {
  return task[field] ?? "";
}

function replaceTask(rows: MoveTask[], next: MoveTask): MoveTask[] {
  return rows.map((row) => (row.id === next.id ? next : row));
}

// Merge a fresh server snapshot over local state WITHOUT disturbing the row the
// user is editing (or one with an in-flight write) — that row keeps its local
// version so an open input never gets clobbered mid-keystroke. If the protected
// row is absent from the snapshot (e.g. the other person deleted it), keep the
// local copy anyway so the open edit doesn't vanish mid-keystroke — the eventual
// PATCH will surface the 404/409 cleanly.
function mergeServerRows(
  server: MoveTask[],
  prev: MoveTask[] | null,
  protectedId: string | null,
): MoveTask[] {
  if (!protectedId || !prev) return server;
  const prevById = new Map(prev.map((row) => [row.id, row] as const));
  const merged = server.map((row) => (row.id === protectedId ? prevById.get(row.id) ?? row : row));
  const protectedRow = prevById.get(protectedId);
  if (protectedRow && !server.some((row) => row.id === protectedId)) merged.push(protectedRow);
  return merged;
}

function errorFromResponse(prefix: string, res: Response): Promise<Error> {
  return res.text().then((text) => new Error(`${prefix}: HTTP ${res.status}${text ? ` ${text}` : ""}`));
}

function StatusButton({
  task,
  disabled,
  onToggle,
}: {
  task: MoveTask;
  disabled: boolean;
  onToggle: (task: MoveTask) => void;
}) {
  const Icon = STATUS_ICON[task.status];
  const tone = STATUS_TONE[task.status];

  return (
    <button
      type="button"
      aria-label={`שינוי סטטוס: ${task.title}`}
      onClick={() => onToggle(task)}
      disabled={disabled}
      title={STATUS_HE[task.status]}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: `1px solid ${tone.bd}`,
        background: tone.bg,
        color: tone.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        flex: "0 0 auto",
      }}
    >
      <Icon style={{ width: 18, height: 18 }} />
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  color,
  bg,
  border,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  color: string;
  bg: string;
  border: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: bg,
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        flex: "0 0 auto",
      }}
    >
      {children}
    </button>
  );
}

// Choose who owns a task. Stores the Hebrew label directly; "" → null (unassigned).
function OwnerSelect({
  task,
  disabled,
  onChange,
}: {
  task: MoveTask;
  disabled: boolean;
  onChange: (task: MoveTask, value: string | null) => void;
}) {
  return (
    <select
      aria-label={`מי: ${task.title}`}
      disabled={disabled}
      value={task.owner ?? ""}
      onChange={(event) => onChange(task, event.currentTarget.value === "" ? null : event.currentTarget.value)}
      style={{
        width: "100%",
        minWidth: 0,
        border: `1px solid ${T.line}`,
        background: T.white,
        color: task.owner ? T.ink2 : T.ink3,
        borderRadius: 6,
        padding: "6px 8px",
        fontSize: 12,
        fontWeight: 600,
        outline: "none",
        textAlign: "right",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <option value="">{OWNER_NONE_LABEL}</option>
      {OWNER_OPTIONS.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

// Relocate a task to another section. Value = current bucket; picking another moves it.
function MoveSelect({
  task,
  disabled,
  onMove,
}: {
  task: MoveTask;
  disabled: boolean;
  onMove: (task: MoveTask, bucket: MoveBucket) => void;
}) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", flex: "0 0 auto" }}>
      <ArrowLeftRight
        style={{ width: 13, height: 13, color: T.ink3, position: "absolute", insetInlineStart: 7, pointerEvents: "none" }}
      />
      <select
        aria-label={`העברת המשימה לסעיף אחר: ${task.title}`}
        title="העברה לסעיף אחר"
        disabled={disabled}
        value={task.bucket}
        onChange={(event) => {
          const next = event.currentTarget.value as MoveBucket;
          if (next !== task.bucket) onMove(task, next);
        }}
        style={{
          width: 132,
          maxWidth: "38vw",
          border: `1px solid ${T.line}`,
          background: T.bg2,
          color: T.ink2,
          borderRadius: 8,
          padding: "7px 8px 7px 22px",
          fontSize: 12,
          fontWeight: 600,
          outline: "none",
          textAlign: "right",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          textOverflow: "ellipsis",
        }}
      >
        {BUCKETS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function InlineCell({
  task,
  field,
  placeholder,
  editing,
  setEditing,
  onCommit,
}: {
  task: MoveTask;
  field: EditableField;
  placeholder: string;
  editing: EditingCell | null;
  setEditing: (editing: EditingCell | null) => void;
  onCommit: (task: MoveTask, field: EditableField, value: string) => Promise<void>;
}) {
  const isEditing = editing?.id === task.id && editing.field === field;
  const value = textForField(task, field);

  if (isEditing) {
    return (
      <input
        autoFocus
        value={editing.value}
        placeholder={placeholder}
        onChange={(event) => setEditing({ ...editing, value: event.currentTarget.value })}
        onBlur={() => void onCommit(task, field, editing.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setEditing(null);
          }
        }}
        style={{
          width: "100%",
          minWidth: 0,
          border: `1px solid ${T.skyDark}`,
          background: T.white,
          color: T.ink,
          borderRadius: 6,
          padding: "7px 9px",
          fontSize: field === "title" ? 14 : 12,
          lineHeight: 1.35,
          outline: "none",
          textAlign: "right",
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing({ id: task.id, field, value })}
      style={{
        width: "100%",
        minWidth: 0,
        border: 0,
        padding: 0,
        background: "transparent",
        color: field === "title" ? T.ink : value ? T.ink2 : T.ink3,
        fontSize: field === "title" ? 14 : 12,
        fontWeight: field === "title" ? 700 : 500,
        lineHeight: 1.45,
        textAlign: "right",
        cursor: "text",
        wordBreak: "break-word",
      }}
    >
      {displayText(value)}
    </button>
  );
}

// Title cell. A buy-item (has purchase options) renders in the buy accent and opens
// the buy popup on click; a normal item is inline-editable as before.
function TitleCell({
  task,
  editing,
  setEditing,
  onCommit,
  onOpenBuy,
}: {
  task: MoveTask;
  editing: EditingCell | null;
  setEditing: (editing: EditingCell | null) => void;
  onCommit: (task: MoveTask, field: EditableField, value: string) => Promise<void>;
  onOpenBuy: (task: MoveTask) => void;
}) {
  if (isBuyItem(task)) {
    return (
      <button
        type="button"
        onClick={() => onOpenBuy(task)}
        title="פתיחת אפשרויות קנייה"
        style={{
          width: "100%",
          minWidth: 0,
          border: 0,
          padding: 0,
          background: "transparent",
          color: BUY_ACCENT,
          fontSize: 14,
          fontWeight: 800,
          lineHeight: 1.45,
          textAlign: "right",
          cursor: "pointer",
          wordBreak: "break-word",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <ShoppingCart style={{ width: 14, height: 14, flex: "0 0 auto" }} />
        <span style={{ textDecoration: "underline", textDecorationColor: BUY_ACCENT_SOFT, textUnderlineOffset: 3 }}>
          {task.title}
        </span>
      </button>
    );
  }
  return (
    <InlineCell task={task} field="title" placeholder="כותרת" editing={editing} setEditing={setEditing} onCommit={onCommit} />
  );
}

// Mobile-only: a labeled, inline-editable meta line (due / notes).
function MetaField({
  label,
  task,
  field,
  placeholder,
  editing,
  setEditing,
  onCommit,
}: {
  label: string;
  task: MoveTask;
  field: EditableField;
  placeholder: string;
  editing: EditingCell | null;
  setEditing: (editing: EditingCell | null) => void;
  onCommit: (task: MoveTask, field: EditableField, value: string) => Promise<void>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "0 0 auto", minWidth: 54, color: T.ink3, fontSize: 11, fontWeight: 700 }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineCell
          task={task}
          field={field}
          placeholder={placeholder}
          editing={editing}
          setEditing={setEditing}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function RowActions({
  task,
  disabled,
  onMove,
  onOpenBuy,
  onDelete,
}: {
  task: MoveTask;
  disabled: boolean;
  onMove: (task: MoveTask, bucket: MoveBucket) => void;
  onOpenBuy: (task: MoveTask) => void;
  onDelete: (task: MoveTask) => void;
}) {
  const buy = isBuyItem(task);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <MoveSelect task={task} disabled={disabled} onMove={onMove} />
      <IconButton
        label="אפשרויות קנייה"
        disabled={disabled}
        onClick={() => onOpenBuy(task)}
        color={buy ? T.white : BUY_ACCENT}
        bg={buy ? BUY_ACCENT : BUY_ACCENT_SOFT}
        border={BUY_ACCENT}
      >
        <ShoppingCart style={{ width: 16, height: 16 }} />
      </IconButton>
      <IconButton
        label={`מחיקה: ${task.title}`}
        disabled={disabled}
        onClick={() => onDelete(task)}
        color={T.red}
        bg={T.white}
        border={T.line}
      >
        <Trash2 style={{ width: 16, height: 16 }} />
      </IconButton>
    </div>
  );
}

function DesktopHeaderRow() {
  const cell = (align: "right" | "center" = "right"): CSSProperties => ({
    color: T.ink3,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.02em",
    textAlign: align,
  });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: DESKTOP_GRID,
        gap: 12,
        alignItems: "center",
        padding: "9px 18px",
        borderBottom: `1px solid ${T.line}`,
        background: T.bg2,
      }}
    >
      <span />
      <span style={cell()}>כותרת</span>
      <span style={cell()}>מי</span>
      <span style={cell()}>עד מתי</span>
      <span style={cell()}>הערות</span>
      <span style={cell("center")}>פעולות</span>
    </div>
  );
}

function TaskRow({
  task,
  isMobile,
  busy,
  editing,
  setEditing,
  onCommit,
  onToggle,
  onSetOwner,
  onMove,
  onOpenBuy,
  onDelete,
}: {
  task: MoveTask;
  isMobile: boolean;
  busy: boolean;
  editing: EditingCell | null;
  setEditing: (editing: EditingCell | null) => void;
  onCommit: (task: MoveTask, field: EditableField, value: string) => Promise<void>;
  onToggle: (task: MoveTask) => void;
  onSetOwner: (task: MoveTask, value: string | null) => void;
  onMove: (task: MoveTask, bucket: MoveBucket) => void;
  onOpenBuy: (task: MoveTask) => void;
  onDelete: (task: MoveTask) => void;
}) {
  const doneBg = task.status === "done" ? T.greenSoft : T.white;

  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${T.line}`,
          background: doneBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusButton task={task} disabled={busy} onToggle={onToggle} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <TitleCell task={task} editing={editing} setEditing={setEditing} onCommit={onCommit} onOpenBuy={onOpenBuy} />
          </div>
          <IconButton
            label="אפשרויות קנייה"
            disabled={busy}
            onClick={() => onOpenBuy(task)}
            color={isBuyItem(task) ? T.white : BUY_ACCENT}
            bg={isBuyItem(task) ? BUY_ACCENT : BUY_ACCENT_SOFT}
            border={BUY_ACCENT}
          >
            <ShoppingCart style={{ width: 16, height: 16 }} />
          </IconButton>
          <IconButton label={`מחיקה: ${task.title}`} disabled={busy} onClick={() => onDelete(task)} color={T.red} bg={T.white} border={T.line}>
            <Trash2 style={{ width: 16, height: 16 }} />
          </IconButton>
        </div>
        <div style={{ display: "grid", gap: 7, paddingInlineStart: 44 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "0 0 auto", minWidth: 54, color: T.ink3, fontSize: 11, fontWeight: 700 }}>מי</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <OwnerSelect task={task} disabled={busy} onChange={onSetOwner} />
            </div>
          </div>
          <MetaField label="עד מתי" task={task} field="due" placeholder="עד מתי" editing={editing} setEditing={setEditing} onCommit={onCommit} />
          <MetaField label="הערות" task={task} field="notes" placeholder="הערות" editing={editing} setEditing={setEditing} onCommit={onCommit} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "0 0 auto", minWidth: 54, color: T.ink3, fontSize: 11, fontWeight: 700 }}>סעיף</span>
            <MoveSelect task={task} disabled={busy} onMove={onMove} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: DESKTOP_GRID,
        gap: 12,
        alignItems: "center",
        padding: "13px 18px",
        borderBottom: `1px solid ${T.line}`,
        background: doneBg,
      }}
    >
      <StatusButton task={task} disabled={busy} onToggle={onToggle} />
      <TitleCell task={task} editing={editing} setEditing={setEditing} onCommit={onCommit} onOpenBuy={onOpenBuy} />
      <OwnerSelect task={task} disabled={busy} onChange={onSetOwner} />
      <InlineCell task={task} field="due" placeholder="עד מתי" editing={editing} setEditing={setEditing} onCommit={onCommit} />
      <InlineCell task={task} field="notes" placeholder="הערות" editing={editing} setEditing={setEditing} onCommit={onCommit} />
      <RowActions task={task} disabled={busy} onMove={onMove} onOpenBuy={onOpenBuy} onDelete={onDelete} />
    </div>
  );
}

// Buy popup: shows up to 4 purchase options as store links, and lets you edit them.
function BuyModal({
  task,
  busy,
  onClose,
  onSave,
}: {
  task: MoveTask;
  busy: boolean;
  onClose: () => void;
  onSave: (task: MoveTask, title: string, options: BuyOption[]) => Promise<void>;
}) {
  const initial = task.buy_options ?? [];
  const [title, setTitle] = useState(task.title);
  const [options, setOptions] = useState<BuyOption[]>(initial.map((o) => ({ ...o })));
  const [edit, setEdit] = useState(initial.length === 0);

  function update(index: number, patch: Partial<BuyOption>) {
    setOptions((current) => current.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function add() {
    setOptions((current) => (current.length >= MAX_BUY_OPTIONS ? current : [...current, { label: "", url: "", price: "" }]));
  }
  function remove(index: number) {
    setOptions((current) => current.filter((_, i) => i !== index));
  }
  function save() {
    const cleaned = options
      .map((o) => ({ label: o.label.trim(), url: o.url.trim(), price: o.price?.trim() || null }))
      .filter((o) => o.url !== "");
    void onSave(task, title.trim() || task.title, cleaned);
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    minWidth: 0,
    border: `1px solid ${T.line}`,
    background: T.white,
    color: T.ink,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    outline: "none",
    textAlign: "right",
    boxSizing: "border-box",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      dir="rtl"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "85vh",
          overflowY: "auto",
          background: T.white,
          borderRadius: 14,
          border: `1px solid ${T.line}`,
          boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ShoppingCart style={{ width: 18, height: 18, color: BUY_ACCENT, flex: "0 0 auto" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.ink, wordBreak: "break-word" }}>{task.title}</h3>
          </div>
          <IconButton label="סגירה" disabled={false} onClick={onClose} color={T.ink2} bg={T.white} border={T.line}>
            <X style={{ width: 16, height: 16 }} />
          </IconButton>
        </div>

        {!edit && options.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {options.map((o, i) => (
              <a
                key={i}
                href={o.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "11px 13px",
                  borderRadius: 9,
                  border: `1px solid ${BUY_ACCENT}`,
                  background: BUY_ACCENT_SOFT,
                  color: BUY_ACCENT,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <ExternalLink style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                </span>
                {o.price ? <span style={{ flex: "0 0 auto", fontWeight: 800 }}>{o.price}</span> : null}
              </a>
            ))}
            <button
              type="button"
              onClick={() => setEdit(true)}
              style={{
                marginTop: 4,
                padding: "9px 12px",
                borderRadius: 8,
                border: `1px solid ${T.line}`,
                background: T.white,
                color: T.ink2,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              עריכת אפשרויות
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>כותרת המשימה</span>
              <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} style={inputStyle} />
            </label>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>אפשרויות קנייה (עד {MAX_BUY_OPTIONS})</div>
            {options.length === 0 ? (
              <div style={{ fontSize: 13, color: T.ink3 }}>אין עדיין אפשרויות — הוסיפו חנות וקישור.</div>
            ) : null}
            {options.map((o, i) => (
              <div key={i} style={{ display: "grid", gap: 6, padding: 10, border: `1px solid ${T.line}`, borderRadius: 9, background: T.bg2 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input placeholder="חנות (למשל bol.com)" value={o.label} onChange={(e) => update(i, { label: e.currentTarget.value })} style={{ ...inputStyle, flex: 2 }} />
                  <input placeholder="מחיר (לא חובה)" value={o.price ?? ""} onChange={(e) => update(i, { price: e.currentTarget.value })} style={{ ...inputStyle, flex: 1 }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input placeholder="https://…" value={o.url} onChange={(e) => update(i, { url: e.currentTarget.value })} style={{ ...inputStyle, flex: 1, direction: "ltr", textAlign: "left" }} />
                  <IconButton label="הסרה" disabled={false} onClick={() => remove(i)} color={T.red} bg={T.white} border={T.line}>
                    <Trash2 style={{ width: 15, height: 15 }} />
                  </IconButton>
                </div>
              </div>
            ))}

            {options.length < MAX_BUY_OPTIONS ? (
              <button
                type="button"
                onClick={add}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: `1px dashed ${BUY_ACCENT}`,
                  background: T.white,
                  color: BUY_ACCENT,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  justifySelf: "start",
                }}
              >
                <Plus style={{ width: 15, height: 15 }} /> הוספת אפשרות
              </button>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${BUY_ACCENT}`,
                  background: BUY_ACCENT,
                  color: T.white,
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                שמירה
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${T.line}`,
                  background: T.white,
                  color: T.ink2,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BucketAddForm({
  bucket,
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  bucket: MoveBucket;
  value: string;
  disabled: boolean;
  onChange: (bucket: MoveBucket, value: string) => void;
  onSubmit: (bucket: MoveBucket) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(bucket);
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 38px",
        gap: 8,
        alignItems: "center",
        marginTop: 14,
      }}
    >
      <input
        value={value}
        onChange={(event) => onChange(bucket, event.currentTarget.value)}
        placeholder="להוסיף פריט"
        disabled={disabled}
        style={{
          minWidth: 0,
          border: `1px solid ${T.line}`,
          background: T.white,
          color: T.ink,
          borderRadius: 6,
          padding: "9px 11px",
          fontSize: 13,
          outline: "none",
          textAlign: "right",
        }}
      />
      <button
        type="submit"
        disabled={disabled || value.trim() === ""}
        aria-label="להוסיף משימה"
        title="להוסיף פריט"
        style={{
          width: 38,
          height: 38,
          borderRadius: 8,
          border: `1px solid ${T.green}`,
          background: T.greenSoft,
          color: T.green,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled || value.trim() === "" ? "default" : "pointer",
          opacity: disabled || value.trim() === "" ? 0.55 : 1,
        }}
      >
        <Plus style={{ width: 17, height: 17 }} />
      </button>
    </form>
  );
}

type AgentSummary = { added: number; updated: number; statusChanged: number; deleted: number; moved: number };
type AgentMessage = { text: string; tone: "ok" | "err" };

// Build the Hebrew "what the agent did" line from the server's counts.
function summaryText(s: AgentSummary, skippedCount: number, note: string | null): string {
  const parts: string[] = [];
  if (s.added) parts.push(`נוספו ${s.added}`);
  if (s.updated) parts.push(`עודכנו ${s.updated}`);
  if (s.moved) parts.push(`הועברו ${s.moved}`);
  if (s.statusChanged) parts.push(`שינוי סטטוס: ${s.statusChanged}`);
  if (s.deleted) parts.push(`נמחקו ${s.deleted}`);
  let msg = parts.length ? parts.join(" · ") : note?.trim() || "לא בוצעו שינויים";
  if (skippedCount > 0) msg += ` · דולגו ${skippedCount}`;
  return msg;
}

// Natural-language assistant bar: type an instruction, the agent edits the list.
function AgentBar({
  value,
  busy,
  message,
  isMobile,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  message: AgentMessage | null;
  isMobile: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const sendDisabled = busy || value.trim() === "";
  return (
    <div style={{ marginBottom: isMobile ? 18 : 24 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 10,
          alignItems: "center",
          border: `1px solid ${T.skyDark}`,
          background: T.skySoft,
          borderRadius: 10,
          padding: isMobile ? "10px 12px" : "12px 14px",
        }}
      >
        <span style={{ display: "inline-flex", color: T.skyDark, flex: "0 0 auto" }}>
          {busy ? (
            <Loader2 className="animate-spin" style={{ width: 20, height: 20 }} />
          ) : (
            <Sparkles style={{ width: 20, height: 20 }} />
          )}
        </span>
        <input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={busy}
          placeholder="כתוב לסוכן מה לעשות… למשל: תעביר את המשימה הזו לאריזה"
          style={{
            minWidth: 0,
            border: 0,
            background: "transparent",
            color: T.ink,
            fontSize: 14,
            outline: "none",
            textAlign: "right",
          }}
        />
        <button
          type="submit"
          disabled={sendDisabled}
          aria-label="הפעל סוכן"
          title="הפעל סוכן"
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${T.skyDark}`,
            background: T.white,
            color: T.skyDark,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: sendDisabled ? "default" : "pointer",
            opacity: sendDisabled ? 0.55 : 1,
            flex: "0 0 auto",
          }}
        >
          <SendHorizontal style={{ width: 18, height: 18, transform: "scaleX(-1)" }} />
        </button>
      </form>
      {message ? (
        <div
          style={{
            marginTop: 8,
            padding: "9px 13px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: message.tone === "ok" ? T.green : T.red,
            background: message.tone === "ok" ? T.greenSoft : T.redSoft,
            border: `1px solid ${message.tone === "ok" ? T.green : T.red}`,
          }}
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}

export function MovePage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<MoveTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingBucket, setAddingBucket] = useState<MoveBucket | null>(null);
  const [buyTaskId, setBuyTaskId] = useState<string | null>(null);
  const [newTitles, setNewTitles] = useState<Record<MoveBucket, string>>({
    A: "",
    B: "",
    C: "",
    D: "",
  });
  const [agentText, setAgentText] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMsg, setAgentMsg] = useState<AgentMessage | null>(null);

  // Latest editing/busy ids, readable from the polling interval without
  // re-subscribing it every keystroke.
  const editingRef = useRef<EditingCell | null>(editing);
  const busyRef = useRef<string | null>(busyId);
  editingRef.current = editing;
  busyRef.current = busyId;

  // Bumped at the start of every mutation. A poll that began before a mutation
  // landed bails before its (now stale) snapshot can revert/hide/resurrect a row.
  const mutationGenRef = useRef(0);

  const loadRows = useCallback(async () => {
    const res = await api("/api/move");
    if (!res.ok) throw await errorFromResponse("טעינת המשימות נכשלה", res);
    const data = (await res.json()) as MoveTask[];
    setRows(data);
    setError(null);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/move");
        if (!res.ok) throw await errorFromResponse("טעינת המשימות נכשלה", res);
        const data = (await res.json()) as MoveTask[];
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "הטעינה נכשלה");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background refresh so a co-editor's changes show up within a few seconds.
  // Skips the row currently being edited / written, and stays quiet on transient
  // failures (no scary error for a single dropped poll).
  useEffect(() => {
    const handle = window.setInterval(() => {
      // Don't poll a backgrounded tab — saves mobile battery + D1 reads.
      if (document.visibilityState !== "visible") return;
      void (async () => {
        const gen = mutationGenRef.current;
        try {
          const res = await api("/api/move");
          if (!res.ok) return;
          const server = (await res.json()) as MoveTask[];
          // A mutation started while this GET was in flight → its snapshot may be
          // stale; drop it and let the next tick (or the mutation's own setRows) win.
          if (gen !== mutationGenRef.current) return;
          const protectedId = editingRef.current?.id ?? busyRef.current ?? null;
          setRows((current) => mergeServerRows(server, current, protectedId));
        } catch {
          // transient network blip — next tick retries
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(handle);
  }, [api]);

  async function patchTask(task: MoveTask, patch: TaskPatch) {
    mutationGenRef.current += 1;
    setBusyId(task.id);
    try {
      const res = await api(`/api/move/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, base_version: task.version }),
      });
      if (res.status === 409) {
        // Someone changed this row underneath us. Show the fresh value, drop our
        // edit, and tell the user calmly — never silently overwrite.
        const payload = (await res.json()) as { current?: MoveTask };
        if (payload.current) {
          setRows((current) => (current ? replaceTask(current, payload.current as MoveTask) : current));
        }
        setError("המשימה עודכנה במקביל — הצגנו את הגרסה העדכנית. בדוק ועדכן שוב אם צריך.");
        return false;
      }
      if (!res.ok) throw await errorFromResponse("עדכון המשימה נכשל", res);
      const updated = (await res.json()) as MoveTask;
      setRows((current) => (current ? replaceTask(current, updated) : current));
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון המשימה נכשל");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function commitEdit(task: MoveTask, field: EditableField, value: string) {
    setEditing(null);
    const normalized = field === "title" ? value.trim() : normalizeEdit(value);
    if (field === "title" && !normalized) {
      setError("אי אפשר להשאיר כותרת ריקה.");
      return;
    }
    if ((task[field] ?? "") === (normalized ?? "")) return;
    await patchTask(task, { [field]: normalized });
  }

  function toggleStatus(task: MoveTask) {
    void patchTask(task, { status: NEXT_STATUS[task.status] });
  }

  function setOwner(task: MoveTask, value: string | null) {
    if ((task.owner ?? null) === (value ?? null)) return;
    void patchTask(task, { owner: value });
  }

  function moveTask(task: MoveTask, bucket: MoveBucket) {
    if (task.bucket === bucket) return;
    void patchTask(task, { bucket });
  }

  async function saveBuyOptions(task: MoveTask, title: string, options: BuyOption[]) {
    const patch: TaskPatch = { buy_options: options.length ? options : null };
    if (title && title !== task.title) patch.title = title;
    const ok = await patchTask(task, patch);
    if (ok) setBuyTaskId(null);
  }

  async function addTask(bucket: MoveBucket) {
    const title = newTitles[bucket].trim();
    if (!title) return;

    mutationGenRef.current += 1;
    setAddingBucket(bucket);
    try {
      const res = await api("/api/move", {
        method: "POST",
        body: JSON.stringify({ bucket, title }),
      });
      if (!res.ok) throw await errorFromResponse("הוספת המשימה נכשלה", res);
      setNewTitles((current) => ({ ...current, [bucket]: "" }));
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "הוספת המשימה נכשלה");
    } finally {
      setAddingBucket(null);
    }
  }

  async function deleteTask(task: MoveTask) {
    mutationGenRef.current += 1;
    setBusyId(task.id);
    try {
      const res = await api(`/api/move/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      if (!res.ok) throw await errorFromResponse("מחיקת המשימה נכשלה", res);
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "מחיקת המשימה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  // Natural-language agent: POST the instruction, then re-render from the
  // server's fresh list (apply-immediately) and report what changed.
  async function runAgent() {
    const instruction = agentText.trim();
    if (!instruction || agentBusy) return;

    mutationGenRef.current += 1;
    setAgentBusy(true);
    setAgentMsg(null);
    try {
      const res = await api("/api/move/agent", {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setAgentMsg({ text: payload?.error || "פעולת הסוכן נכשלה. נסה שוב.", tone: "err" });
        return;
      }
      const data = (await res.json()) as {
        summary: AgentSummary;
        skipped: unknown[];
        note: string | null;
        tasks: MoveTask[];
        refreshError?: string | null;
      };
      if (data.refreshError) {
        // Ops applied, but the server's post-write reload failed — its `tasks` is
        // empty and not the truth. Refetch rather than blanking the list.
        await loadRows().catch(() => {});
      } else {
        setRows(data.tasks);
      }
      setAgentText("");
      setError(null);
      setAgentMsg({ text: summaryText(data.summary, data.skipped?.length ?? 0, data.note), tone: "ok" });
    } catch (e) {
      setAgentMsg({ text: e instanceof Error ? e.message : "פעולת הסוכן נכשלה.", tone: "err" });
    } finally {
      setAgentBusy(false);
    }
  }

  function rowsForBucket(bucket: MoveBucket): MoveTask[] {
    return (rows ?? []).filter((row) => row.bucket === bucket);
  }

  const buyTask = buyTaskId ? (rows ?? []).find((row) => row.id === buyTaskId) ?? null : null;

  return (
    <div dir="rtl" style={{
      fontFamily: "Inter, 'Arial Hebrew', Arial, sans-serif",
      boxSizing: "border-box",
      padding: isMobile ? "20px 14px 60px" : "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: isMobile ? "12px 6px 24px" : "32px 20px 40px", marginBottom: isMobile ? 18 : 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, marginBottom: 14,
          }}>
            לוגיסטיקה · מעבר דירה
          </div>
          <h1 style={{
            fontSize: isMobile ? 25 : 34, fontWeight: 800, color: T.ink,
            margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            🏠 מעבר דירה
          </h1>
          <p style={{
            fontSize: isMobile ? 14 : 16, color: T.ink2, lineHeight: 1.65,
            maxWidth: 720, margin: "0 auto",
          }}>
            מסירת קלוסטרהוף, תשתיות, סידור הבית החדש ואריזה — הכל במעקב אחד שאפשר לערוך.
          </p>
        </div>

        <AgentBar
          value={agentText}
          busy={agentBusy}
          message={agentMsg}
          isMobile={isMobile}
          onChange={setAgentText}
          onSubmit={() => void runAgent()}
        />

        {error ? (
          <div style={{
            padding: "16px 20px",
            color: T.red,
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 18,
          }}>
            {error}
          </div>
        ) : null}

        {rows === null ? (
          <div style={{
            padding: 24, fontSize: 14, color: T.ink3,
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            טוען…
          </div>
        ) : (
          <div style={{ display: "grid", gap: isMobile ? 18 : 24 }}>
            {BUCKETS.map((bucket) => (
              <section
                key={bucket.id}
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  background: T.white,
                  overflow: "hidden",
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "16px 18px",
                  borderBottom: `1px solid ${T.line}`,
                  background: T.bg2,
                }}>
                  <h2 style={{ margin: 0, color: T.ink, fontSize: isMobile ? 15 : 17, fontWeight: 800 }}>
                    {bucket.title}
                  </h2>
                  <span style={{
                    color: T.ink2,
                    background: T.skySoft,
                    border: `1px solid ${T.line}`,
                    borderRadius: 999,
                    padding: "3px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                    {rowsForBucket(bucket.id).length}
                  </span>
                </div>

                <div style={{ display: "grid" }}>
                  {!isMobile && rowsForBucket(bucket.id).length > 0 ? <DesktopHeaderRow /> : null}
                  {rowsForBucket(bucket.id).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isMobile={isMobile}
                      busy={busyId === task.id}
                      editing={editing}
                      setEditing={setEditing}
                      onCommit={commitEdit}
                      onToggle={toggleStatus}
                      onSetOwner={setOwner}
                      onMove={moveTask}
                      onOpenBuy={(t) => setBuyTaskId(t.id)}
                      onDelete={(t) => void deleteTask(t)}
                    />
                  ))}
                </div>

                <div style={{ padding: "0 18px 16px", background: T.white }}>
                  <BucketAddForm
                    bucket={bucket.id}
                    value={newTitles[bucket.id]}
                    disabled={addingBucket === bucket.id}
                    onChange={(nextBucket, value) => setNewTitles((current) => ({ ...current, [nextBucket]: value }))}
                    onSubmit={(nextBucket) => void addTask(nextBucket)}
                  />
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {buyTask ? (
        <BuyModal
          task={buyTask}
          busy={busyId === buyTask.id}
          onClose={() => setBuyTaskId(null)}
          onSave={saveBuyOptions}
        />
      ) : null}
    </div>
  );
}

(MovePage as unknown as { path: string }).path = "/move";
