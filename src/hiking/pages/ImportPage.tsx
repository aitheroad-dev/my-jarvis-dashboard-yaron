import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, CheckCircle2 } from "lucide-react";
import { parseCsv } from "../lib/csv";
import { importPoints } from "../lib/store";
import { PALETTE, TAG_LABELS } from "../lib/taxonomy";
import type { PointOfInterest } from "../lib/types";

type FieldKey = "name" | "description" | "region" | "lat" | "lng" | "tags" | "imageUrl";

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "name", label: "שם", required: true },
  { key: "description", label: "תיאור" },
  { key: "region", label: "אזור בארץ" },
  { key: "lat", label: "קו רוחב" },
  { key: "lng", label: "קו אורך" },
  { key: "tags", label: "תגיות (מופרדות בפסיק)" },
  { key: "imageUrl", label: "קישור לתמונה" },
];

const GUESS: Record<FieldKey, string[]> = {
  name: ["שם", "name", "מקום"],
  description: ["תיאור", "description"],
  region: ["אזור", "איזור", "region"],
  lat: ["רוחב", "lat", "latitude"],
  lng: ["אורך", "lng", "lon", "longitude"],
  tags: ["תגי", "קטגור", "tag", "category"],
  imageUrl: ["תמונה", "image", "img"],
};

function guessColumn(headers: string[], key: FieldKey): string {
  const hit = headers.find((h) => GUESS[key].some((g) => h.toLowerCase().includes(g)));
  return hit ?? "";
}

export function ImportPage() {
  const navigate = useNavigate();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState(0);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCsv(String(reader.result ?? ""));
      setHeaders(h);
      setRows(r);
      const m = {} as Record<FieldKey, string>;
      for (const f of FIELDS) m[f.key] = guessColumn(h, f.key);
      setMapping(m);
      setDone(0);
    };
    reader.readAsText(file);
  }

  const preview = useMemo(() => buildRows(rows, headers, mapping).slice(0, 5), [rows, headers, mapping]);
  const total = useMemo(() => buildRows(rows, headers, mapping).length, [rows, headers, mapping]);

  function runImport() {
    const built = buildRows(rows, headers, mapping);
    const n = importPoints(built);
    setDone(n);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="hiking-display text-3xl" style={{ color: PALETTE.trail }}>
        ייבוא נקודות מקובץ CSV
      </h1>
      <p className="text-sm" style={{ color: PALETTE.ink }}>
        העלו קובץ CSV, מפו את העמודות לשדות הנקודה ואשרו. הנקודות יתווספו למאגר
        המקומי שלכם ויופיעו ברשימה הראשית.
      </p>

      <label
        className="map-card flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-sm"
        style={{ borderColor: PALETTE.mustard + "88", color: PALETTE.earth }}
      >
        <Upload size={18} />
        {fileName ? `נבחר: ${fileName}` : "בחרו קובץ CSV"}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>

      {headers.length > 0 && (
        <>
          <section className="map-card space-y-3 rounded-2xl p-5">
            <h2 className="hiking-display text-lg" style={{ color: PALETTE.trail }}>
              מיפוי שדות
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="mb-1 block font-medium" style={{ color: PALETTE.ink }}>
                    {f.label}
                    {f.required && <span style={{ color: "#a23b2e" }}> *</span>}
                  </span>
                  <select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    className="w-full rounded-lg border bg-white px-3 py-2 outline-none"
                    style={{ borderColor: PALETTE.earth + "44" }}
                  >
                    <option value="">— ללא —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          {preview.length > 0 && (
            <section className="map-card overflow-x-auto rounded-2xl p-5">
              <h2 className="hiking-display mb-3 text-lg" style={{ color: PALETTE.trail }}>
                תצוגה מקדימה ({total} שורות)
              </h2>
              <table className="w-full text-right text-xs">
                <thead>
                  <tr style={{ color: PALETTE.earth }}>
                    <th className="p-1">שם</th>
                    <th className="p-1">אזור</th>
                    <th className="p-1">קואורדינטות</th>
                    <th className="p-1">תגיות</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: PALETTE.earth + "22" }}>
                      <td className="p-1 font-medium">{p.name}</td>
                      <td className="p-1">{p.region || "—"}</td>
                      <td className="p-1" dir="ltr">
                        {p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : "—"}
                      </td>
                      <td className="p-1">{p.tags.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runImport}
              disabled={!mapping.name || total === 0}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: PALETTE.trail }}
            >
              ייבוא {total} נקודות
            </button>
            {done > 0 && (
              <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: PALETTE.trail }}>
                <CheckCircle2 size={16} />
                יובאו {done} נקודות בהצלחה.
                <button type="button" onClick={() => navigate("/")} className="underline">
                  לרשימה
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function buildRows(
  rows: string[][],
  headers: string[],
  mapping: Record<FieldKey, string>,
): Array<Omit<PointOfInterest, "id" | "createdDate">> {
  const idx = (key: FieldKey): number => {
    const col = mapping[key];
    return col ? headers.indexOf(col) : -1;
  };
  const cell = (row: string[], key: FieldKey): string => {
    const i = idx(key);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };

  const out: Array<Omit<PointOfInterest, "id" | "createdDate">> = [];
  for (const row of rows) {
    const name = cell(row, "name");
    if (!name) continue;
    const latRaw = cell(row, "lat");
    const lngRaw = cell(row, "lng");
    const lat = latRaw ? Number(latRaw) : null;
    const lng = lngRaw ? Number(lngRaw) : null;
    const tags = cell(row, "tags")
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter((t) => TAG_LABELS.includes(t));
    out.push({
      name,
      description: cell(row, "description"),
      region: cell(row, "region"),
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,
      tags,
      imageUrl: cell(row, "imageUrl"),
    });
  }
  return out;
}
