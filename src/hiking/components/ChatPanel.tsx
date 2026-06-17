import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { usePoints } from "../lib/store";
import { runChat, type ChatResult } from "../lib/chat";
import { EXAMPLE_PROMPTS, PALETTE } from "../lib/taxonomy";
import { PoiCard } from "./PoiCard";
import { MapView } from "./MapView";

export function ChatPanel() {
  const points = usePoints();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ChatResult | null>(null);

  function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setQuery(text);
    setResult(runChat(text, points));
  }

  return (
    <section className="map-card rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={18} style={{ color: PALETTE.mustard }} />
        <h2 className="hiking-display text-lg" style={{ color: PALETTE.trail }}>
          שאלו את מתכנן הטיולים
        </h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='לדוגמה: "תבנה לי טיול לסופ״ש במצפה רמון"'
          className="flex-1 rounded-xl border bg-white px-3 py-2 text-sm outline-none"
          style={{ borderColor: PALETTE.earth + "44" }}
        />
        <button
          type="submit"
          className="flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: PALETTE.trail }}
        >
          <Send size={15} />
          שליחה
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => ask(p)}
            className="rounded-full border px-3 py-1 text-xs transition hover:bg-white"
            style={{ borderColor: PALETTE.mustard + "66", color: PALETTE.earth }}
          >
            {p}
          </button>
        ))}
      </div>

      {result && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: PALETTE.earth + "22" }}>
          <p className="mb-3 text-sm font-medium" style={{ color: PALETTE.ink }}>
            {result.message}
          </p>

          {result.kind === "trip" && (
            <div className="space-y-3">
              <MapView points={result.points} route={result.points} numbered height={300} />
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.points.map((p, i) => (
                  <li key={p.id}>
                    <PoiCard point={p} index={i} />
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.kind === "single" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.points.map((p) => (
                <PoiCard key={p.id} point={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
