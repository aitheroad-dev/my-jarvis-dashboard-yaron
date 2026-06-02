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
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
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
const WORK_DIR = `${PAI}/MEMORY/WORK`;

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
  created_at: string; // the memory's own date (file birth time), NOT the sync time
  metadata: Record<string, unknown>;
};

/** Date of the memory itself: file birth time, falling back to modified time. */
function memoryDate(path: string): string {
  const st = statSync(path);
  const birth = st.birthtime;
  const d = birth && birth.getTime() > 0 ? birth : st.mtime;
  return d.toISOString();
}

function readMemories(): MemoryRow[] {
  if (!existsSync(MEMORY_DIR)) return [];
  return readdirSync(MEMORY_DIR)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    .map((f) => {
      const path = `${MEMORY_DIR}/${f}`;
      const { fm, body } = frontmatter(read(path));
      return {
        type: mapMemoryType(fm.type),
        title: fm.name || f.replace(/\.md$/, ""),
        body: body.trim(),
        created_at: memoryDate(path),
        metadata: {
          source: "pai-auto-memory",
          slug: f.replace(/\.md$/, ""),
          origin_type: fm.type ?? null,
          description: fm.description ?? null,
        },
      };
    });
}

// ── tickets: thin face of ISA-bearing work units, + projected ISA content ──
type Isc = { id: string; text: string; done: boolean };
type TicketRow = {
  slug: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done" | "archived";
  current_step: string | null;
  tier: string | null;
  progress: string | null;
  isa_path: string;
  agent: string | null;
  project_slug: string | null;
  sections: Record<string, string | null>;
  iscs: Isc[];
};

/** Canonical ISA `## Heading` → tickets prose column. Criteria → iscs jsonb. */
const SECTION_COLUMN: Record<string, string> = {
  Problem: "problem",
  Vision: "vision",
  "Out of Scope": "out_of_scope",
  Principles: "principles",
  Constraints: "constraints",
  Goal: "goal",
  "Test Strategy": "test_strategy",
  Features: "features",
  Decisions: "decisions",
  Changelog: "changelog",
  Verification: "verification",
};

/** Match a possibly-suffixed heading ("Out of Scope (v1)") to its canonical name. */
function canonicalHeading(h: string): string | null {
  const names = ["Criteria", ...Object.keys(SECTION_COLUMN)];
  for (const n of names) if (h === n || h.startsWith(n + " ")) return n;
  return null;
}

/**
 * Project an ISA's body into content columns + ISC checklist. MUST stay
 * byte-identical to PAI hooks/lib/ticket-push.ts parseIsaProjection() so
 * batch and real-time sync never disagree.
 */
function parseIsaProjection(content: string): {
  sections: Record<string, string | null>;
  iscs: Isc[];
} {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const sections: Record<string, string | null> = {};
  const iscs: Isc[] = [];
  for (const part of body.split(/^##\s+/m)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const heading = canonicalHeading(part.slice(0, nl).trim());
    if (!heading) continue;
    const text = part.slice(nl + 1).trim();
    if (heading === "Criteria") {
      for (const line of text.split("\n")) {
        const m = line.match(/^- \[(.+?)\]\s+(ISC-[\d.]+)\s*:?\s*(.*)$/);
        if (m) {
          iscs.push({
            id: m[2],
            text: m[3].trim(),
            done: m[1].trim().toLowerCase() === "x",
          });
        }
      }
      continue;
    }
    sections[SECTION_COLUMN[heading]] = text || null;
  }
  return { sections, iscs };
}

const ALGO_STEPS = new Set([
  "OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN", "COMPLETE",
]);

/**
 * Canonical status derivation: ISC progress + an on-disk done marker.
 * THE single mapping; the real-time ticket-push hook mirrors this exactly so
 * batch and live sync never disagree.
 *   - phase 'complete' → 'done'  (the durable, disk-side confirmation marker)
 *   - all ISCs done (total>0)    → 'review'
 *   - ≥1 ISC done                → 'in_progress'
 *   - else (incl. 0/0 stub)      → 'todo'
 */
export function deriveTicketStatus(
  phase: string,
  iscsDone: number,
  iscsTotal: number,
): TicketRow["status"] {
  if (phase.toLowerCase() === "complete") return "done";
  if (iscsTotal > 0 && iscsDone === iscsTotal) return "review";
  if (iscsDone >= 1) return "in_progress";
  return "todo";
}

/**
 * Read MEMORY/WORK/*\/ISA.md and project each into a thin ticket.
 * FILTER: only ISA-bearing E2+ work becomes a ticket — trivial E1/native
 * chatter (no ISA, or effort < E2) never reaches the board.
 */
/** Read one ISA file → a ticket row, or null if absent / not E2+. */
function readIsaTicket(
  isaPath: string,
  relPath: string,
  fallbackSlug: string,
  isProjectDir = false,
): TicketRow | null {
  if (!existsSync(isaPath)) return null;
  const content = read(isaPath);
  const { fm } = frontmatter(content);
  // Containers are not tickets. `kind: project` is explicit; for ISAs under
  // USER/PROJECTS we also treat an unset kind as a container, so an un-stamped
  // project ISA never regresses into a "done" card.
  const isContainer = fm.kind === "project" || (isProjectDir && fm.kind == null);
  if (isContainer) return null;
  // Discriminator = the ISA file exists (checked above). No effort-tier gate:
  // trivial work writes no ISA, so chatter is already excluded.
  const effort = (fm.effort || "").toUpperCase();
  const slug = fm.slug || (fm.project ? kebab(fm.project) : "") || fallbackSlug;
  const step = (fm.phase || "").toUpperCase();
  const { sections, iscs } = parseIsaProjection(content);
  const iscsDone = iscs.filter((i) => i.done).length;
  const iscsTotal = iscs.length;
  return {
    slug,
    title: fm.title || fm.task || slug,
    status: deriveTicketStatus(fm.phase || "", iscsDone, iscsTotal),
    current_step: ALGO_STEPS.has(step) ? step : null,
    tier: effort || null,
    progress:
      (fm.phase || "").toLowerCase() === "complete"
        ? fm.progress || (iscsTotal > 0 ? `${iscsTotal}/${iscsTotal}` : null)
        : iscsTotal > 0
          ? `${iscsDone}/${iscsTotal}`
          : fm.progress || null,
    isa_path: relPath,
    agent: fm.agent || null,
    project_slug: fm.project ? kebab(fm.project) : null,
    sections,
    iscs,
  };
}

function readTickets(): TicketRow[] {
  const rows: TicketRow[] = [];
  // Work-session ISAs — MEMORY/WORK/<slug>/ISA.md (ad-hoc / one-shot work).
  if (existsSync(WORK_DIR))
    for (const dir of readdirSync(WORK_DIR)) {
      const r = readIsaTicket(
        `${WORK_DIR}/${dir}/ISA.md`,
        `MEMORY/WORK/${dir}/ISA.md`,
        dir,
      );
      if (r) rows.push(r);
    }
  // Project ISAs — USER/PROJECTS/<NAME>/ISA.md (persistent project identity).
  const PROJ_DIR = `${PAI}/USER/PROJECTS`;
  if (existsSync(PROJ_DIR))
    for (const dir of readdirSync(PROJ_DIR)) {
      const r = readIsaTicket(
        `${PROJ_DIR}/${dir}/ISA.md`,
        `USER/PROJECTS/${dir}/ISA.md`,
        kebab(dir),
        true, // project-dir: unset kind defaults to container
      );
      if (r) rows.push(r);
    }
  return rows;
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
  tickets: TicketRow[],
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
      INSERT INTO memories (type, title, body, metadata, created_at)
      VALUES (${m.type}, ${m.title}, ${m.body}, ${JSON.stringify(m.metadata)}::jsonb, ${m.created_at})
    `;
  }

  // tickets — upsert by slug, source='pai'. The WHERE guard on DO UPDATE means
  // a row a human owns (source='manual') is NEVER clobbered by the sync.
  for (const t of tickets) {
    const s = t.sections;
    await sql`
      INSERT INTO tickets (
        slug, title, status, current_step, tier, progress, isa_path, source, agent, project_id,
        problem, vision, out_of_scope, principles, constraints, goal,
        test_strategy, features, decisions, changelog, verification, iscs, updated_at
      )
      VALUES (
        ${t.slug}, ${t.title}, ${t.status}, ${t.current_step}, ${t.tier}, ${t.progress}, ${t.isa_path}, 'pai', ${t.agent}, (SELECT id FROM projects WHERE slug = ${t.project_slug}),
        ${s.problem ?? null}, ${s.vision ?? null}, ${s.out_of_scope ?? null},
        ${s.principles ?? null}, ${s.constraints ?? null}, ${s.goal ?? null},
        ${s.test_strategy ?? null}, ${s.features ?? null}, ${s.decisions ?? null},
        ${s.changelog ?? null}, ${s.verification ?? null}, ${JSON.stringify(t.iscs)}::jsonb, NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title, status = EXCLUDED.status,
        current_step = EXCLUDED.current_step, tier = EXCLUDED.tier,
        progress = EXCLUDED.progress, isa_path = EXCLUDED.isa_path,
        agent = COALESCE(EXCLUDED.agent, tickets.agent),
        project_id = COALESCE(EXCLUDED.project_id, tickets.project_id),
        problem = EXCLUDED.problem, vision = EXCLUDED.vision,
        out_of_scope = EXCLUDED.out_of_scope, principles = EXCLUDED.principles,
        constraints = EXCLUDED.constraints, goal = EXCLUDED.goal,
        test_strategy = EXCLUDED.test_strategy, features = EXCLUDED.features,
        decisions = EXCLUDED.decisions, changelog = EXCLUDED.changelog,
        verification = EXCLUDED.verification, iscs = EXCLUDED.iscs,
        updated_at = NOW()
      WHERE tickets.source = 'pai'
    `;
  }
}

// ── main ─────────────────────────────────────────────────────────────────
const projects = readProjects();
const goals = readGoals();
const agents = readAgents();
const memories = readMemories();
const tickets = readTickets();

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
console.log(`  tickets  : ${tickets.length}  (ISA-bearing E2+ work units)`);
for (const t of tickets)
  console.log(`     • ${t.slug.padEnd(28)} [${t.status}] ${t.tier} ${t.progress ?? ""}  ${t.title}`);

if (DRY_RUN) {
  console.log("\n✓ Dry run complete. No database touched. Re-run without --dry-run to write.\n");
} else {
  await syncLive(projects, goals, agents, memories, tickets);
  console.log("\n✓ Live sync complete.\n");
}
