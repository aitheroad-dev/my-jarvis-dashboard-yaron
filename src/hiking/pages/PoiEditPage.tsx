import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Save } from "lucide-react";
import { upsertPoint, usePoint } from "../lib/store";
import { PALETTE, REGIONS, TAGS } from "../lib/taxonomy";
import { TagPill } from "../components/TagPill";

export function PoiEditPage() {
  const { id } = useParams();
  const existing = usePoint(id);
  const navigate = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [lat, setLat] = useState(existing?.lat != null ? String(existing.lat) : "");
  const [lng, setLng] = useState(existing?.lng != null ? String(existing.lng) : "");
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");
  const [googleUrl, setGoogleUrl] = useState(existing?.googleUrl ?? "");
  const [tags, setTags] = useState<Set<string>>(new Set(existing?.tags ?? []));
  const [error, setError] = useState("");

  if (isEdit && !existing) {
    return (
      <div className="map-card rounded-2xl p-8 text-center">
        <p className="mb-3" style={{ color: PALETTE.ink }}>
          הנקודה לעריכה לא נמצאה.
        </p>
        <Link to="/" className="underline" style={{ color: PALETTE.trail }}>
          חזרה לרשימה
        </Link>
      </div>
    );
  }

  function toggleTag(label: string) {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("שם הנקודה הוא שדה חובה.");
      return;
    }
    const latNum = lat.trim() ? Number(lat) : null;
    const lngNum = lng.trim() ? Number(lng) : null;
    if ((lat.trim() && Number.isNaN(latNum)) || (lng.trim() && Number.isNaN(lngNum))) {
      setError("קואורדינטות חייבות להיות מספרים (לדוגמה 32.79, 35.01).");
      return;
    }
    const saved = upsertPoint({
      id: existing?.id,
      name: name.trim(),
      description: description.trim(),
      region: region.trim(),
      lat: latNum,
      lng: lngNum,
      imageUrl: imageUrl.trim(),
      googleUrl: googleUrl.trim() || undefined,
      tags: [...tags],
    });
    navigate(`/poi/${saved.id}`);
  }

  const inputStyle = { borderColor: PALETTE.earth + "44" };
  const fieldClass = "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to={existing ? `/poi/${existing.id}` : "/"} className="inline-flex items-center gap-1 text-sm" style={{ color: PALETTE.earth }}>
        <ArrowRight size={15} />
        חזרה
      </Link>

      <h1 className="hiking-display text-3xl" style={{ color: PALETTE.trail }}>
        {isEdit ? "עריכת נקודת עניין" : "הוספת נקודת עניין"}
      </h1>

      <form onSubmit={submit} className="map-card space-y-4 rounded-2xl p-5">
        <Field label="שם הנקודה *">
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} style={inputStyle} />
        </Field>

        <Field label="תיאור">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={fieldClass}
            style={inputStyle}
          />
        </Field>

        <Field label="אזור בארץ">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={fieldClass} style={inputStyle}>
            <option value="">בחרו אזור…</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="קו רוחב (lat)">
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="32.7940" className={fieldClass} style={inputStyle} inputMode="decimal" />
          </Field>
          <Field label="קו אורך (lng)">
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="34.9896" className={fieldClass} style={inputStyle} inputMode="decimal" />
          </Field>
        </div>

        <Field label="תגיות">
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => (
              <TagPill key={t.label} label={t.label} active={tags.has(t.label)} onClick={() => toggleTag(t.label)} size="sm" />
            ))}
          </div>
        </Field>

        <Field label="קישור לתמונה">
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className={fieldClass} style={inputStyle} dir="ltr" />
        </Field>

        <Field label="קישור ל-Google Maps">
          <input value={googleUrl} onChange={(e) => setGoogleUrl(e.target.value)} placeholder="https://maps.google.com/…" className={fieldClass} style={inputStyle} dir="ltr" />
        </Field>

        {error && (
          <p className="text-sm font-medium" style={{ color: "#a23b2e" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          style={{ background: PALETTE.trail }}
        >
          <Save size={16} />
          שמירה
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium" style={{ color: PALETTE.ink }}>
        {label}
      </span>
      {children}
    </label>
  );
}
