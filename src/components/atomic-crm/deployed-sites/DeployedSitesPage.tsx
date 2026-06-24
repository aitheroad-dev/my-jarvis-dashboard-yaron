import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Edit3, ExternalLink, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useApi } from "@/lib/api";
import { architectureT as T } from "../blueprint/ArchitectureBlocks";

type DeployedSite = {
  id: string;
  project: string;
  name: string;
  url: string;
  note: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type SiteForm = {
  project: string;
  name: string;
  url: string;
  note: string;
};

type SitePatch = Partial<Pick<DeployedSite, "project" | "name" | "url">> & { note?: string | null };

type ProjectGroup = {
  project: string;
  sites: DeployedSite[];
};

const EMPTY_FORM: SiteForm = { project: "", name: "", url: "", note: "" };

function errorFromResponse(prefix: string, res: Response): Promise<Error> {
  return res.text().then((text) => new Error(`${prefix}: HTTP ${res.status}${text ? ` ${text}` : ""}`));
}

function normalizeNote(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function replaceSite(rows: DeployedSite[], next: DeployedSite): DeployedSite[] {
  return rows.map((row) => (row.id === next.id ? next : row));
}

function groupSites(rows: DeployedSite[]): ProjectGroup[] {
  const groups = new Map<string, DeployedSite[]>();
  for (const row of rows) {
    const current = groups.get(row.project) ?? [];
    current.push(row);
    groups.set(row.project, current);
  }
  return [...groups.entries()].map(([project, sites]) => ({ project, sites }));
}

function iconButtonStyle(color: string, bg: string, border: string, disabled: boolean): CSSProperties {
  return {
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
  };
}

function fieldStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    border: `1px solid ${T.line}`,
    background: T.white,
    color: T.ink,
    borderRadius: 8,
    padding: isMobile ? "10px 11px" : "10px 12px",
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
    boxSizing: "border-box",
  };
}

function formToPayload(form: SiteForm): { project: string; name: string; url: string; note: string | null } {
  return {
    project: form.project.trim(),
    name: form.name.trim(),
    url: form.url.trim(),
    note: normalizeNote(form.note),
  };
}

function AddSiteForm({
  value,
  isMobile,
  disabled,
  onChange,
  onSubmit,
}: {
  value: SiteForm;
  isMobile: boolean;
  disabled: boolean;
  onChange: (value: SiteForm) => void;
  onSubmit: () => void;
}) {
  function updateField(field: keyof SiteForm, next: string) {
    onChange({ ...value, [field]: next });
  }

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: 8,
        background: T.white,
        overflow: "hidden",
        marginBottom: isMobile ? 18 : 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${T.line}`,
          background: T.bg2,
        }}
      >
        <Plus style={{ width: 17, height: 17, color: T.skyDark }} />
        <h2 style={{ margin: 0, color: T.ink, fontSize: isMobile ? 15 : 17, fontWeight: 800 }}>Add deployed site</h2>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(130px, 0.75fr) minmax(160px, 1fr) minmax(220px, 1.45fr) minmax(160px, 1fr) 92px",
          gap: 10,
          padding: 16,
          alignItems: "start",
        }}
      >
        <input
          aria-label="Project"
          placeholder="Project"
          value={value.project}
          disabled={disabled}
          onChange={(event) => updateField("project", event.currentTarget.value)}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="Site name"
          placeholder="Name"
          value={value.name}
          disabled={disabled}
          onChange={(event) => updateField("name", event.currentTarget.value)}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="URL"
          placeholder="https://..."
          value={value.url}
          disabled={disabled}
          onChange={(event) => updateField("url", event.currentTarget.value)}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="Note"
          placeholder="Note"
          value={value.note}
          disabled={disabled}
          onChange={(event) => updateField("note", event.currentTarget.value)}
          style={fieldStyle(isMobile)}
        />
        <button
          type="submit"
          disabled={disabled}
          style={{
            height: 40,
            border: `1px solid ${T.skyDark}`,
            borderRadius: 8,
            background: T.skyDark,
            color: T.white,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            fontSize: 13,
            fontWeight: 800,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {disabled ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Plus style={{ width: 15, height: 15 }} />}
          Add
        </button>
      </div>
    </form>
  );
}

function SiteCard({
  site,
  isMobile,
  busy,
  editing,
  onStartEdit,
  onCancelEdit,
  onEditChange,
  onSave,
  onDelete,
}: {
  site: DeployedSite;
  isMobile: boolean;
  busy: boolean;
  editing: SiteForm | null;
  onStartEdit: (site: DeployedSite) => void;
  onCancelEdit: () => void;
  onEditChange: (value: SiteForm) => void;
  onSave: (site: DeployedSite) => void;
  onDelete: (site: DeployedSite) => void;
}) {
  const isEditing = editing !== null;
  const actions = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      {isEditing ? (
        <>
          <button
            type="button"
            aria-label={`Save ${site.name}`}
            title="Save"
            disabled={busy}
            onClick={() => onSave(site)}
            style={iconButtonStyle(T.white, T.green, T.green, busy)}
          >
            {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Save style={{ width: 16, height: 16 }} />}
          </button>
          <button
            type="button"
            aria-label={`Cancel editing ${site.name}`}
            title="Cancel"
            disabled={busy}
            onClick={onCancelEdit}
            style={iconButtonStyle(T.ink2, T.bg2, T.line, busy)}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </>
      ) : (
        <button
          type="button"
          aria-label={`Edit ${site.name}`}
          title="Edit"
          disabled={busy}
          onClick={() => onStartEdit(site)}
          style={iconButtonStyle(T.ink2, T.bg2, T.line, busy)}
        >
          <Edit3 style={{ width: 16, height: 16 }} />
        </button>
      )}
      <button
        type="button"
        aria-label={`Delete ${site.name}`}
        title="Delete"
        disabled={busy}
        onClick={() => onDelete(site)}
        style={iconButtonStyle(T.red, T.white, T.line, busy)}
      >
        <Trash2 style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );

  if (isEditing) {
    return (
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSave(site);
        }}
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(130px, 0.75fr) minmax(160px, 1fr) minmax(220px, 1.5fr) minmax(150px, 1fr) 84px",
          gap: 10,
          padding: 14,
          border: `1px solid ${T.line}`,
          borderRadius: 12,
          background: T.white,
          alignItems: "start",
        }}
      >
        <input
          aria-label="Project"
          value={editing.project}
          disabled={busy}
          onChange={(event) => onEditChange({ ...editing, project: event.currentTarget.value })}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="Site name"
          value={editing.name}
          disabled={busy}
          onChange={(event) => onEditChange({ ...editing, name: event.currentTarget.value })}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="URL"
          value={editing.url}
          disabled={busy}
          onChange={(event) => onEditChange({ ...editing, url: event.currentTarget.value })}
          style={fieldStyle(isMobile)}
        />
        <input
          aria-label="Note"
          value={editing.note}
          disabled={busy}
          onChange={(event) => onEditChange({ ...editing, note: event.currentTarget.value })}
          style={fieldStyle(isMobile)}
        />
        {actions}
      </form>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(180px, 1.2fr) minmax(260px, 1.7fr) minmax(150px, 1fr) 84px",
        gap: isMobile ? 10 : 14,
        padding: isMobile ? "14px 14px" : "15px 16px",
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        background: T.white,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.ink, fontSize: 14, fontWeight: 800, lineHeight: 1.35, wordBreak: "break-word" }}>{site.name}</div>
      </div>
      <a
        href={site.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          color: T.skyDark,
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.45,
          textDecoration: "none",
          wordBreak: "break-all",
        }}
      >
        <ExternalLink style={{ width: 15, height: 15, flex: "0 0 auto" }} />
        <span>{site.url}</span>
      </a>
      <div style={{ minWidth: 0, color: site.note ? T.ink2 : T.ink3, fontSize: 13, lineHeight: 1.45, wordBreak: "break-word" }}>
        {site.note ?? "No note"}
      </div>
      {actions}
    </div>
  );
}

export function DeployedSitesPage() {
  const api = useApi();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<DeployedSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState<SiteForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SiteForm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const loadRows = useCallback(async () => {
    const res = await api("/api/deployed-sites");
    if (!res.ok) throw await errorFromResponse("Loading deployed sites failed", res);
    const data = (await res.json()) as DeployedSite[];
    setRows(data);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/deployed-sites");
        if (!res.ok) throw await errorFromResponse("Loading deployed sites failed", res);
        const data = (await res.json()) as DeployedSite[];
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Loading deployed sites failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const groups = useMemo(() => groupSites(rows ?? []), [rows]);

  async function addSite() {
    const payload = formToPayload(newSite);
    if (!payload.project || !payload.name || !payload.url || adding) return;

    setAdding(true);
    try {
      const res = await api("/api/deployed-sites", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse("Adding deployed site failed", res);
      await loadRows();
      setNewSite(EMPTY_FORM);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adding deployed site failed");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(site: DeployedSite) {
    setEditingId(site.id);
    setEditing({
      project: site.project,
      name: site.name,
      url: site.url,
      note: site.note ?? "",
    });
  }

  async function saveSite(site: DeployedSite) {
    if (!editing || busyId) return;
    const payload = formToPayload(editing);
    if (!payload.project || !payload.name || !payload.url) return;

    const patch: SitePatch = {};
    if (payload.project !== site.project) patch.project = payload.project;
    if (payload.name !== site.name) patch.name = payload.name;
    if (payload.url !== site.url) patch.url = payload.url;
    if (payload.note !== site.note) patch.note = payload.note;

    setBusyId(site.id);
    try {
      const res = await api(`/api/deployed-sites/${encodeURIComponent(site.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw await errorFromResponse("Updating deployed site failed", res);
      const updated = (await res.json()) as DeployedSite;
      setRows((current) => (current ? replaceSite(current, updated) : current));
      setEditingId(null);
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Updating deployed site failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSite(site: DeployedSite) {
    if (busyId) return;
    setBusyId(site.id);
    try {
      const res = await api(`/api/deployed-sites/${encodeURIComponent(site.id)}`, { method: "DELETE" });
      if (!res.ok) throw await errorFromResponse("Deleting deployed site failed", res);
      await loadRows();
      if (editingId === site.id) {
        setEditingId(null);
        setEditing(null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deleting deployed site failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box",
        padding: isMobile ? "20px 14px 60px" : "40px 48px 80px",
      }}
    >
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: isMobile ? "12px 6px 24px" : "32px 20px 40px", marginBottom: isMobile ? 18 : 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.skyDark, marginBottom: 14 }}>
            OPERATIONS · DEPLOYED URLS
          </div>
          <h1 style={{ fontSize: isMobile ? 25 : 34, fontWeight: 800, color: T.ink, margin: "0 0 14px", lineHeight: 1.15 }}>
            Deployed Sites
          </h1>
          <p style={{ fontSize: isMobile ? 14 : 16, color: T.ink2, lineHeight: 1.65, maxWidth: 720, margin: "0 auto" }}>
            A grouped registry of live pages and Workers, with quick launch links and inline maintenance.
          </p>
        </div>

        <AddSiteForm value={newSite} isMobile={isMobile} disabled={adding} onChange={setNewSite} onSubmit={() => void addSite()} />

        {error ? (
          <div
            style={{
              padding: "16px 20px",
              color: T.red,
              background: T.redSoft,
              border: `1px solid ${T.red}`,
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 18,
            }}
          >
            {error}
          </div>
        ) : null}

        {rows === null ? (
          <div
            style={{
              padding: 24,
              fontSize: 14,
              color: T.ink3,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading...
          </div>
        ) : groups.length === 0 ? (
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, background: T.white, padding: 24, color: T.ink3, fontSize: 14 }}>
            No deployed sites yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: isMobile ? 18 : 24 }}>
            {groups.map((group) => (
              <section
                key={group.project}
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 8,
                  background: T.white,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "16px 18px",
                    borderBottom: `1px solid ${T.line}`,
                    background: T.bg2,
                  }}
                >
                  <h2 style={{ margin: 0, color: T.ink, fontSize: isMobile ? 15 : 17, fontWeight: 800 }}>{group.project}</h2>
                  <span
                    style={{
                      color: T.ink2,
                      background: T.skySoft,
                      border: `1px solid ${T.line}`,
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {group.sites.length}
                  </span>
                </div>
                <div style={{ display: "grid", gap: 10, padding: isMobile ? 12 : 14, background: T.bg }}>
                  {group.sites.map((site) => (
                    <SiteCard
                      key={site.id}
                      site={site}
                      isMobile={isMobile}
                      busy={busyId === site.id}
                      editing={editingId === site.id ? editing : null}
                      onStartEdit={startEdit}
                      onCancelEdit={() => {
                        setEditingId(null);
                        setEditing(null);
                      }}
                      onEditChange={setEditing}
                      onSave={(nextSite) => void saveSite(nextSite)}
                      onDelete={(nextSite) => void deleteSite(nextSite)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

(DeployedSitesPage as unknown as { path: string }).path = "/deployed-sites";
