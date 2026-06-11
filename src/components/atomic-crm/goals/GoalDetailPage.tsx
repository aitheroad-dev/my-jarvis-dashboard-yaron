// GoalDetailPage.tsx — MJOS-049
//
// Renders a goal as a BlockRenderer recipe stored in `goals.body`, matching
// the SkillDetailPage canonical pattern. Page chrome (hero from columns)
// wraps the body. No react-markdown fallback (per AC-4).

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import {
  architectureConfig,
  architectureT as T,
} from "../blueprint/ArchitectureBlocks";
import { BlockRenderer, type Block } from "../blueprint/BlockRenderer";

type GoalDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  status: "active" | "paused" | "done" | "archived";
  project_id: string;
  project_slug: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
};

function parseRecipe(body: string): Block[] | null {
  const trimmed = body?.trim() ?? "";
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && Array.isArray(parsed.blocks)) return parsed.blocks as Block[];
  } catch {
    return null;
  }
  return null;
}

const STATUS_TONE: Record<GoalDetail["status"], { fg: string; bg: string; bd: string }> = {
  active:   { fg: T.green, bg: T.greenSoft, bd: T.green },
  paused:   { fg: T.amber, bg: T.amberSoft, bd: T.amber },
  done:     { fg: T.skyDark, bg: T.skySoft, bd: T.skyDark },
  archived: { fg: T.ink3, bg: T.bg2, bd: T.line },
};

export function GoalDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const api = useApi();
  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setError(null);
    setGoal(null);
    (async () => {
      try {
        const res = await api(`/api/goals/${slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GoalDetail;
        if (!cancelled) setGoal(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const bodyRecipe = useMemo(() => goal ? parseRecipe(goal.body) : null, [goal]);

  return (
    <div style={{
      fontFamily: "Inter, sans-serif",
      boxSizing: "border-box",
      padding: "40px 48px 80px",
    }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link to="/goals-list" style={{
            color: T.accent, fontSize: 13, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <ChevronLeft style={{ width: 14, height: 14 }} /> Goals
          </Link>
        </div>

        {error ? (
          <div style={{
            padding: "16px 20px", color: T.red, background: T.redSoft,
            border: `1px solid ${T.red}`, borderRadius: 8, fontSize: 13,
          }}>
            Failed to load goal: <code>{slug}</code> — {error}
          </div>
        ) : goal === null ? (
          <div style={{ padding: 24, fontSize: 14, color: T.ink3,
            display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            Loading…
          </div>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "32px 20px 40px", marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                color: T.skyDark, textTransform: "uppercase", marginBottom: 14,
              }}>
                GOAL · {goal.slug}
              </div>
              <h1 style={{
                fontSize: 34, fontWeight: 800, color: T.ink,
                margin: "0 0 14px", letterSpacing: "-0.02em", lineHeight: 1.15,
              }}>
                {goal.title}
              </h1>
              {goal.description ? (
                <p style={{
                  fontSize: 16, color: T.ink2, lineHeight: 1.65,
                  maxWidth: 720, margin: "0 auto",
                }}>
                  {goal.description}
                </p>
              ) : null}
              <div style={{ marginTop: 20 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: STATUS_TONE[goal.status].fg,
                  background: STATUS_TONE[goal.status].bg,
                  border: `1px solid ${STATUS_TONE[goal.status].bd}`,
                  padding: "3px 10px", borderRadius: 999,
                }}>
                  {goal.status}
                </span>
              </div>
            </div>

            {bodyRecipe ? (
              <BlockRenderer config={architectureConfig} blocks={bodyRecipe} />
            ) : null}

            <div style={{
              fontSize: 11, color: T.ink3, paddingTop: 24,
              borderTop: `1px dashed ${T.line}`, marginTop: 48,
              textAlign: "center", letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              Updated {new Date(goal.updated_at).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

(GoalDetailPage as unknown as { path: string }).path = "/goals/:slug";
