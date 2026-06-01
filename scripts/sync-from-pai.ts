#!/usr/bin/env bun
/**
 * sync-from-pai.ts — push-side ingestion: PAI disk sources → Neon.
 *
 * The dashboard's read APIs (functions/api/*) SELECT from Neon. Nothing keeps
 * those tables current with Yaron's living PAI data — they were seeded once on
 * 2026-05-20 and froze. This tool is the missing write side: it reads the
 * canonical sources on disk and idempotently upserts them into Neon so the
 * dashboard stops being a snapshot.
 *
 * MODEL: Neon is a disposable PROJECTION of disk. Disk stays source of truth.
 * One-way only — this tool never reads Neon as authority, only writes to it.
 * Re-runnable: upsert by stable key (slug / name); PAI-sourced memories are
 * replaced wholesale by source tag. Non-destructive to dashboard-native rows
 * (e.g. the `life` and `update-telos` projects that have no PAI source).
 *
 * USAGE:
 *   bun scripts/sync-from-pai.ts --dry-run   # read + map + report, NO DB, no credential
 *   bun scripts/sync-from-pai.ts             # live upsert (needs DATABASE_URL)
 *
 * CREDENTIAL: DATABASE_URL from env, or a `.dev.vars` file (gitignored) holding
 *   DATABASE_URL=postgres://...   (the same Neon string set as the wrangler secret)
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

// ── paths ────────────────────────────────────────────────────────────────
const HOME = process.env.HOME!;
const PAI = process.env.PAI_DIR ?? `${HOME}/.claude/PAI`;
const PROJECTS_MD = `${PAI}/USER/PROJECTS/PROJECTS.md`;
const GOALS_MD = `${PAI}/USER/TELOS/GOALS.md`;
const AGENTS_DIR = `${HOME}/.config/myjarvis/agents`;
const MEMORY_DIR =
  process.env.CLAUDE_MEMORY_DIR ??
  `${HOME}/.claude/projects/-Users-yaronkra/memory`;

const DRY_RUN = process.argv.includes("--dry-run");

// ── helpers ──────────────────────────────────────────────────────────────
function kebab(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Parse `---`-delimited YAML-ish frontmatter into a flat record + body. */
function frontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

/** Extract a `## Heading` section's body (until the next `## `). */
function section(md: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "im");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

function normStatus(raw: string): "active" | "paused" | "done" {
  // Only the leading status word counts — the rest of the line is prose that
  // may contain words like "kickoff complete" that must NOT flip the status.
  const s = raw.split(/[—–-]/)[0].trim().toLowerCase();
  if (/pause/.test(s)) return "paused";
  if (/done|complete|shipped/.test(s)) return "done";
  return "active";
}

// Known slug mismatches between the PAI directory name and the dashboard's
// existing seed slug. Maps parsed-slug → canonical-DB-slug so we update the
// existing row instead of creating a duplicate.
const SLUG_ALIASES: Record<string, string> = {
  "max-security": "mji-max-security",
};

// ── source readers ─────────────────────────────────────────────────────────
type ProjectRow = {
  slug: string;
  name: string;
  mission: string;
  status: "active" | "paused" | "done";
  body: string;
};

function readProjects(): ProjectRow[] {
  const md = read(PROJECTS_MD);
  const baseDir = dirname(PROJECTS_MD);
  const rows: ProjectRow[] = [];
  // Section → default status. PROJECTS.md groups Active / Paused / Completed.
  const sectionStatus: Record<string, "active" | "paused" | "done"> = {
    Active: "active",
    Paused: "paused",
    Completed: "done",
  };
  let current: "active" | "paused" | "done" = "active";
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(\w+)/);
    if (h && sectionStatus[h[1]]) {
      current = sectionStatus[h[1]];
      continue;
    }
    // - [Name](./DIR/PROJECT.md) — description
    const link = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+PROJECT\.md)\)\s*(?:—\s*(.*))?/);
    if (!link) continue;
    const [, name, relPath, desc] = link;
    const projectMdPath = resolve(baseDir, relPath);
    const rawSlug = kebab(basename(dirname(projectMdPath)));
    const slug = SLUG_ALIASES[rawSlug] ?? rawSlug;
    const pmd = read(projectMdPath);
    const statusLine = pmd.match(/\*\*Status:\*\*\s*(.+)/);
    const status = statusLine ? normStatus(statusLine[1]) : current;
    const mission = section(pmd, "Mission") || (desc ?? "").trim();
    rows.push({ slug, name: name.trim(), mission, status, body: pmd || "" });
  }
  return rows;
}

type GoalRow = { gNum: number; slug: string; title: string; description: string };

function readGoals(): GoalRow[] {
  const md = read(GOALS_MD);
  const active = section(md, "Active");
  const rows: GoalRow[] = [];
  for (const line of active.split("\n")) {
    // - **G0:** Get every project ... — measurable: ...
    const m = line.match(/^\s*-\s*\*\*G(\d+):\*\*\s*(.+)$/);
    if (!m) continue;
    const gNum = Number(m[1]);
    const text = m[2].trim();
    const title = text.split("—")[0].split(" - ")[0].trim().slice(0, 120);
    rows.push({
      gNum,
      slug: `g${gNum}`, // reconciled against existing g{N}-* slug in live mode
      title: `G${gNum} — ${title}`,
      description: text,
    });
  }
  return rows;
}

type AgentRow = {
  name: string;
  display_name: string;
  voice_kokoro: string;
  color: string | null;
  identity_md: string | null;
};

function readAgents(): AgentRow[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const j = JSON.parse(read(`${AGENTS_DIR}/${f}`));
      return {
        name: j.name,
        display_name: j.display ?? j.name,
        voice_kokoro: j.voice ?? "",
        color: j.color ?? null,
        identity_md: j.tone ?? null,
      };
    });
}

type MemoryType =
  | "session_log"
  | "learning"
  | "user_fact"
  | "area"
  | "principle"
  | "identity";

function mapMemoryType(t: string): MemoryType {
  switch ((t || "").toLowerCase()) {
    case "user":
      return "user_fact";
    case "feedback":
      return "learning";
    case "identity":
      return "identity";
    case "principle":
      return "principle";
    case "project":
    case "reference":
    default:
      return "area";
  }
}

type MemoryRow = {
  type: MemoryType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};

function readMemories(): MemoryRow[] {
  if (!existsSync(MEMORY_DIR)) return [];
  return readdirSync(MEMORY_DIR)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    .map((f) => {
      const { fm, body } = frontmatter(read(`${MEMORY_DIR}/${f}`));
      return {
        type: mapMemoryType(fm.type),
        title: fm.name || f.replace(/\.md$/, ""),
        body: body.trim(),
        metadata: {
          source: "pai-auto-memory",
          slug: f.replace(/\.md$/, ""),
          origin_type: fm.type ?? null,
          description: fm.description ?? null,
        },
      };
    });
}

// ── DB upserts ───────────────────────────────────────────────────────────
function getDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const devVars = resolve(import.meta.dir, "..", ".dev.vars");
  if (existsSync(devVars)) {
    const m = read(devVars).match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

async function syncLive(
  projects: ProjectRow[],
  goals: GoalRow[],
  agents: AgentRow[],
  memories: MemoryRow[],
) {
  const url = getDatabaseUrl();
  if (!url) {
    console.error(
      "\n✗ DATABASE_URL not found. Provide the Neon connection string via:\n" +
        "  • env:  DATABASE_URL=postgres://... bun scripts/sync-from-pai.ts\n" +
        "  • file: echo 'DATABASE_URL=postgres://...' >> .dev.vars   (gitignored)\n" +
        "Or run with --dry-run to preview without a database.\n",
    );
    process.exit(1);
  }
  const sql = neon(url);

  // projects — upsert by slug (non-destructive to dashboard-native rows)
  for (const p of projects) {
    await sql`
      INSERT INTO projects (slug, name, mission, status, body, updated_at)
      VALUES (${p.slug}, ${p.name}, ${p.mission}, ${p.status}, ${p.body}, NOW())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, mission = EXCLUDED.mission,
        status = EXCLUDED.status, body = EXCLUDED.body, updated_at = NOW()
    `;
  }

  // goals — FK to the `life` project; reconcile against existing g{N}-* slug
  const life = (await sql`SELECT id FROM projects WHERE slug = 'life' LIMIT 1`) as {
    id: string;
  }[];
  const lifeId = life[0]?.id ?? null;
  const existingGoals = (await sql`SELECT id, slug FROM goals`) as {
    id: string;
    slug: string;
  }[];
  for (const g of goals) {
    const match = existingGoals.find((e) => new RegExp(`^g${g.gNum}(-|$)`).test(e.slug));
    if (match) {
      await sql`
        UPDATE goals SET title = ${g.title}, description = ${g.description},
          status = 'active', updated_at = NOW()
        WHERE id = ${match.id}
      `;
    } else if (lifeId) {
      await sql`
        INSERT INTO goals (slug, project_id, title, description, status)
        VALUES (${g.slug}, ${lifeId}, ${g.title}, ${g.description}, 'active')
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
      `;
    }
  }

  // agents — upsert by name (PK)
  for (const a of agents) {
    await sql`
      INSERT INTO agents (name, display_name, voice_kokoro, voice_mcp, color, identity_md, updated_at)
      VALUES (${a.name}, ${a.display_name}, ${a.voice_kokoro}, NULL, ${a.color}, ${a.identity_md}, NOW())
      ON CONFLICT (name) DO UPDATE SET
        display_name = EXCLUDED.display_name, voice_kokoro = EXCLUDED.voice_kokoro,
        color = EXCLUDED.color, identity_md = EXCLUDED.identity_md, updated_at = NOW()
    `;
  }

  // memories — replace the PAI-sourced set wholesale (idempotent by source tag)
  await sql`DELETE FROM memories WHERE metadata->>'source' = 'pai-auto-memory'`;
  for (const m of memories) {
    await sql`
      INSERT INTO memories (type, title, body, metadata)
      VALUES (${m.type}, ${m.title}, ${m.body}, ${JSON.stringify(m.metadata)}::jsonb)
    `;
  }
}

// ── main ─────────────────────────────────────────────────────────────────
const projects = readProjects();
const goals = readGoals();
const agents = readAgents();
const memories = readMemories();

console.log(`\nPAI → Neon sync  ${DRY_RUN ? "(DRY RUN — no DB writes)" : "(LIVE)"}\n`);
console.log(`  projects : ${projects.length}`);
for (const p of projects) console.log(`     • ${p.slug.padEnd(24)} [${p.status}] ${p.name}`);
console.log(`  goals    : ${goals.length}`);
for (const g of goals) console.log(`     • ${g.slug.padEnd(24)} ${g.title}`);
console.log(`  agents   : ${agents.length}`);
for (const a of agents) console.log(`     • ${a.name.padEnd(24)} ${a.display_name} (${a.voice_kokoro})`);
console.log(`  memories : ${memories.length}`);
const byType = memories.reduce<Record<string, number>>((acc, m) => {
  acc[m.type] = (acc[m.type] ?? 0) + 1;
  return acc;
}, {});
console.log(`     by type: ${JSON.stringify(byType)}`);

if (DRY_RUN) {
  console.log("\n✓ Dry run complete. No database touched. Re-run without --dry-run to write.\n");
} else {
  await syncLive(projects, goals, agents, memories);
  console.log("\n✓ Live sync complete.\n");
}
