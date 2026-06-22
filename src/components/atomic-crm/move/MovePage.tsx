import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, CircleDot, Loader2, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

type MoveBucket = "A" | "B" | "C" | "D";
type MoveStatus = "todo" | "doing" | "done";

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
};

type EditableField = "title" | "owner" | "due" | "notes";

type EditingCell = {
  id: string;
  field: EditableField;
  value: string;
};

// Bucket keys (A–D) are the stored data; titles are Hebrew display labels
// (kept in sync with the move-share page).
const BUCKETS: { id: MoveBucket; title: string }[] = [
  { id: "A", title: "מסירת הבית (קלוסטרהוף)" },
  { id: "B", title: "תשתיות וכתובת" },
  { id: "C", title: "הבית החדש" },
  { id: "D", title: "אריזה ולוגיסטיקה" },
];

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

export function MovePage() {
  const api = useApi();
  const [rows, setRows] = useState<MoveTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingBucket, setAddingBucket] = useState<MoveBucket | null>(null);
  const [newTitles, setNewTitles] = useState<Record<MoveBucket, string>>({
    A: "",
    B: "",
    C: "",
    D: "",
  });

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

  async function patchTask(task: MoveTask, patch: Partial<Pick<MoveTask, EditableField | "status">>) {
    setBusyId(task.id);
    try {
      const res = await api(`/api/move/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw await errorFromResponse("עדכון המשימה נכשל", res);
      const updated = (await res.json()) as MoveTask;
      setRows((current) => (current ? replaceTask(current, updated) : current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון המשימה נכשל");
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

  async function addTask(bucket: MoveBucket) {
    const title = newTitles[bucket].trim();
    if (!title) return;

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

  function rowsForBucket(bucket: MoveBucket): MoveTask[] {
    return (rows ?? []).filter((row) => row.bucket === bucket);
  }

  return (
    <div dir="rtl" style={{
      fontFamily: "Inter, 'Arial Hebrew', Arial, sans-serif",
      boxSizing: "border-box",
      padding: "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "32px 20px 40px", marginBottom: 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
            color: T.skyDark, marginBottom: 14,
          }}>
            לוגיסטיקה · מעבר דירה
          </div>
          <h1 style={{
            fontSize: 34, fontWeight: 800, color: T.ink,
            margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
          }}>
            🏠 מעבר דירה
          </h1>
          <p style={{
            fontSize: 16, color: T.ink2, lineHeight: 1.65,
            maxWidth: 720, margin: "0 auto",
          }}>
            מסירת קלוסטרהוף, תשתיות, סידור הבית החדש ואריזה — הכל במעקב אחד שאפשר לערוך.
          </p>
        </div>

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
          <div style={{ display: "grid", gap: 24 }}>
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
                  <h2 style={{ margin: 0, color: T.ink, fontSize: 17, fontWeight: 800 }}>
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
                  {rowsForBucket(bucket.id).map((task) => (
                    <div
                      key={task.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "34px minmax(220px, 1.7fr) minmax(60px, 0.35fr) minmax(70px, 0.45fr) minmax(160px, 1fr) 34px",
                        gap: 12,
                        alignItems: "center",
                        padding: "13px 18px",
                        borderBottom: `1px solid ${T.line}`,
                        background: task.status === "done" ? T.greenSoft : T.white,
                      }}
                    >
                      <StatusButton
                        task={task}
                        disabled={busyId === task.id}
                        onToggle={(nextTask) => void patchTask(nextTask, { status: NEXT_STATUS[nextTask.status] })}
                      />
                      <InlineCell
                        task={task}
                        field="title"
                        placeholder="כותרת"
                        editing={editing}
                        setEditing={setEditing}
                        onCommit={commitEdit}
                      />
                      <InlineCell
                        task={task}
                        field="owner"
                        placeholder="מי"
                        editing={editing}
                        setEditing={setEditing}
                        onCommit={commitEdit}
                      />
                      <InlineCell
                        task={task}
                        field="due"
                        placeholder="עד מתי"
                        editing={editing}
                        setEditing={setEditing}
                        onCommit={commitEdit}
                      />
                      <InlineCell
                        task={task}
                        field="notes"
                        placeholder="הערות"
                        editing={editing}
                        setEditing={setEditing}
                        onCommit={commitEdit}
                      />
                      <button
                        type="button"
                        aria-label={`מחיקה: ${task.title}`}
                        title="מחיקה"
                        disabled={busyId === task.id}
                        onClick={() => void deleteTask(task)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          border: `1px solid ${T.line}`,
                          background: T.white,
                          color: T.red,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: busyId === task.id ? "default" : "pointer",
                          opacity: busyId === task.id ? 0.55 : 1,
                        }}
                      >
                        <Trash2 style={{ width: 16, height: 16 }} />
                      </button>
                    </div>
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
    </div>
  );
}

(MovePage as unknown as { path: string }).path = "/move";
