#!/usr/bin/env bun
/**
 * harvest-situation.ts — the Situation Board's only writer.
 *
 * Harvests "what happened" per project from PAI's existing paper trail and
 * upserts it into D1 (REST API — wrangler d1 breaks under Bun). Batch,
 * deterministic, idempotent. No always-on machinery: run it, it reports, it
 * exits. A failed source NEVER silently skips — it prints in the status table
 * and flips the exit code to 1 (partial harvest).
 *
 * Sources:
 *   1. projects   — USER/PROJECTS/PROJECTS.md "## Active" (system of record)
 *   2. git        — commits from ~/Projects + ~/code repos name-matched to
 *                   project slugs (≥5-char normalized overlap; overrides in
 *                   scripts/situation.overrides.json)
 *   3. work       — MEMORY/WORK/<dir>/ISA.md frontmatter (sessions/milestones)
 *   4. memory     — memory/project_*.md dated narrative lines (wrap-up voice)
 *
 * Mapping gaps are a FEATURE of the output, not a failure: unmapped projects
 * land in situation_projects with health 'no-signal' and render as loud
 * anomaly cards on /situation.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const HOME = homedir();
const PROJECTS_MD = join(HOME, ".claude/PAI/USER/PROJECTS/PROJECTS.md");
const WORK_DIR = join(HOME, ".claude/PAI/MEMORY/WORK");
const MEMORY_DIR = join(HOME, ".claude/projects/-Users-yaronkra/memory");
const REPO_ROOTS = [join(HOME, "Projects"), join(HOME, "code")];
const OVERRIDES_PATH = join(import.meta.dir, "situation.overrides.json");
const DB_ID = "bede39da-5d58-4a2d-9198-89f9f6e2804c";
const GIT_SINCE_DAYS = 60;
const MAX_EVENTS_PER_PROJECT = 200;

// ---------- D1 REST ----------

type D1Response = {
  success: boolean;
  errors: { code: number; message: string }[];
  result: { results: Record<string, unknown>[] }[];
};

function loadCreds(): { accountId: string; token: string } {
  const acc = JSON.parse(readFileSync(join(HOME, ".config/cloudflare/account.json"), "utf8"));
  const token = readFileSync(join(HOME, ".config/cloudflare/api-token"), "utf8").trim();
  return { accountId: acc.account_id, token };
}

const creds = loadCreds();

async function d1(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = (await res.json()) as D1Response;
  if (!res.ok || !body.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(body.errors)} :: ${sql.slice(0, 120)}`);
  }
  return body.result?.[0]?.results ?? [];
}

// ---------- helpers ----------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** ≥5-char containment match between normalized names, both directions. */
function nameMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na.length < 5 || nb.length < 5) return na === nb;
  return na.includes(nb) || nb.includes(na);
}

function stableHash(s: string): string {
  // FNV-1a 32-bit, hex — stable across runs, good enough for event ids.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[-*>\s]+/, "")
    .trim();
}

type SourceStatus = { ok: boolean; count: number; note?: string; error?: string };
const status: Record<string, SourceStatus> = {};

type Project = { slug: string; name: string; goal: string };
type Ev = { id: string; project_slug: string; ts: string; kind: string; title: string; detail: string | null; source: string };

// ---------- 1. projects from PROJECTS.md ----------

function parseProjects(): Project[] {
  const text = readFileSync(PROJECTS_MD, "utf8");
  const active = text.split(/^## Active$/m)[1]?.split(/^## /m)[0] ?? "";
  const projects: Project[] = [];
  for (const line of active.split("\n")) {
    const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\)\s*—\s*(.*)$/);
    if (!m) continue; // top-level entries only; nested sub-bullets are indented
    const [, name, link, descRaw] = m;
    const dir = basename(link.replace(/\/PROJECT\.md.*$/i, "").replace(/\/README\.md.*$/i, ""));
    const desc = stripMd(descRaw);
    const goal = (desc.split(/(?<=[.;])\s/)[0] ?? desc).slice(0, 200);
    projects.push({ slug: norm(dir), name, goal });
  }
  return projects;
}

// ---------- 2. git commits ----------

type Overrides = Record<string, { repos?: string[]; exclude?: boolean }>;

function loadOverrides(): Overrides {
  if (!existsSync(OVERRIDES_PATH)) return {};
  return JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")) as Overrides;
}

function discoverRepos(): string[] {
  const repos: string[] = [];
  for (const root of REPO_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const p = join(root, entry);
      try {
        if (statSync(p).isDirectory() && existsSync(join(p, ".git"))) repos.push(p);
      } catch { /* unreadable entry — skip */ }
    }
  }
  return repos;
}

async function gitEvents(projects: Project[]): Promise<{ events: Ev[]; mapped: number; unmappedRepos: string[] }> {
  const overrides = loadOverrides();
  const repos = discoverRepos();
  const events: Ev[] = [];
  const mappedRepos = new Set<string>();

  for (const project of projects) {
    const ov = overrides[project.slug];
    if (ov?.exclude) continue;
    const matched = new Set<string>(ov?.repos ?? []);
    for (const repo of repos) {
      if (nameMatch(basename(repo), project.slug)) matched.add(repo);
    }
    for (const repo of matched) {
      if (!existsSync(repo)) continue;
      mappedRepos.add(repo);
      const proc = Bun.spawnSync(
        ["git", "-C", repo, "log", `--since=${GIT_SINCE_DAYS} days ago`, "--pretty=%H|%cI|%s"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (proc.exitCode !== 0) {
        throw new Error(`git log failed for ${repo}: ${proc.stderr.toString().slice(0, 200)}`);
      }
      for (const line of proc.stdout.toString().split("\n")) {
        if (!line.trim()) continue;
        const [hash, ts, ...rest] = line.split("|");
        const subject = rest.join("|").trim();
        if (!hash || !ts || !subject) continue;
        events.push({
          id: `commit:${hash}`,
          project_slug: project.slug,
          ts,
          kind: /deploy|ship|live/i.test(subject) ? "deploy" : "commit",
          title: subject.slice(0, 240),
          detail: null,
          source: basename(repo),
        });
      }
    }
  }
  const unmappedRepos = repos.filter((r) => !mappedRepos.has(r)).map((r) => basename(r));
  return { events, mapped: mappedRepos.size, unmappedRepos };
}

// ---------- 3. PAI work sessions ----------

function fm(content: string, key: string): string | null {
  const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function workEvents(projects: Project[]): { events: Ev[]; mapped: number; unmapped: number } {
  const events: Ev[] = [];
  let mapped = 0;
  let unmapped = 0;
  if (!existsSync(WORK_DIR)) throw new Error(`missing ${WORK_DIR}`);
  for (const dir of readdirSync(WORK_DIR)) {
    const isaPath = join(WORK_DIR, dir, "ISA.md");
    if (!existsSync(isaPath)) continue;
    const content = readFileSync(isaPath, "utf8").slice(0, 4000);
    const task = fm(content, "task");
    const updated = fm(content, "updated");
    if (!task || !updated) continue;
    const phase = fm(content, "phase") ?? "?";
    const progress = fm(content, "progress") ?? "";
    const projRef = fm(content, "project");
    const target = projects.find(
      (p) => (projRef && nameMatch(projRef, p.slug)) || nameMatch(dir, p.slug),
    );
    if (!target) {
      unmapped++;
      continue;
    }
    mapped++;
    events.push({
      id: `work:${dir}:${updated.slice(0, 10)}`,
      project_slug: target.slug,
      ts: updated,
      kind: phase === "complete" ? "milestone" : "session",
      title: task.slice(0, 240),
      detail: `phase ${phase}${progress ? `, ${progress}` : ""}`,
      source: `MEMORY/WORK/${dir}`,
    });
  }
  return { events, mapped, unmapped };
}

// ---------- 4. memory narratives ----------

function memoryEvents(projects: Project[]): { events: Ev[]; nextBySlug: Map<string, string[]>; mapped: number; unmapped: number } {
  const events: Ev[] = [];
  const nextBySlug = new Map<string, string[]>();
  let mapped = 0;
  let unmapped = 0;
  if (!existsSync(MEMORY_DIR)) throw new Error(`missing ${MEMORY_DIR}`);
  for (const file of readdirSync(MEMORY_DIR)) {
    if (!file.startsWith("project_") || !file.endsWith(".md")) continue;
    const content = readFileSync(join(MEMORY_DIR, file), "utf8");
    const nameKey = file.replace(/^project_/, "").replace(/\.md$/, "");
    const target = projects.find((p) => nameMatch(nameKey, p.slug));
    if (!target) {
      unmapped++;
      continue;
    }
    mapped++;
    for (const raw of content.split("\n")) {
      const dm = raw.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dm) continue;
      const title = stripMd(raw).slice(0, 240);
      if (title.length < 12) continue;
      events.push({
        id: `mem:${file}:${stableHash(raw)}`,
        project_slug: target.slug,
        ts: `${dm[1]}T12:00:00Z`,
        kind: "note",
        title,
        detail: null,
        source: file,
      });
    }
    // Next steps — "next =", "NEXT:", "open:" phrases, split into short items.
    const nexts: string[] = [];
    for (const m of content.matchAll(/(?:next\s*=|next:|open:)\s*([^\n]+)/gi)) {
      for (const part of m[1].split(/[;/]| \+ /)) {
        const item = stripMd(part).replace(/[*_]+/g, "").trim();
        if (item.length >= 6 && nexts.length < 5) nexts.push(item.slice(0, 160));
      }
    }
    if (nexts.length > 0) nextBySlug.set(target.slug, nexts);
  }
  return { events, nextBySlug, mapped, unmapped };
}

// ---------- write ----------

async function upsertAll(projects: Project[], events: Ev[], nextBySlug: Map<string, string[]>): Promise<void> {
  // Per-project rollups.
  const byProject = new Map<string, Ev[]>();
  for (const e of events) {
    const list = byProject.get(e.project_slug) ?? [];
    list.push(e);
    byProject.set(e.project_slug, list);
  }

  const nowMs = Date.now();
  for (const p of projects) {
    const evs = (byProject.get(p.slug) ?? []).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_EVENTS_PER_PROJECT);
    byProject.set(p.slug, evs);
    const last = evs[0]?.ts ?? null;
    const days = last ? (nowMs - new Date(last).getTime()) / 86_400_000 : Infinity;
    const health = !last ? "no-signal" : days < 7 ? "active" : days <= 14 ? "quiet" : "stalled";
    await d1(
      `INSERT INTO situation_projects (slug, name, goal, now_text, health, last_activity, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET name=excluded.name, goal=excluded.goal,
         now_text=excluded.now_text, health=excluded.health,
         last_activity=excluded.last_activity, updated_at=excluded.updated_at`,
      [p.slug, p.name, p.goal, evs[0]?.title ?? null, health, last],
    );

    await d1(`DELETE FROM situation_next WHERE project_slug = ?`, [p.slug]);
    const nexts = nextBySlug.get(p.slug) ?? [];
    for (let i = 0; i < nexts.length; i++) {
      await d1(`INSERT INTO situation_next (project_slug, position, text) VALUES (?, ?, ?)`, [p.slug, i + 1, nexts[i]]);
    }
  }

  // Events in chunks of 14 (7 binds each = 98 params; D1 REST caps at 100).
  const all = [...byProject.values()].flat();
  for (let i = 0; i < all.length; i += 14) {
    const chunk = all.slice(i, i + 14);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((e) => [e.id, e.project_slug, e.ts, e.kind, e.title, e.detail, e.source]);
    await d1(
      `INSERT INTO situation_events (id, project_slug, ts, kind, title, detail, source) VALUES ${values}
       ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, kind=excluded.kind, title=excluded.title,
         detail=excluded.detail, source=excluded.source`,
      params,
    );
  }

  await d1(
    `INSERT INTO situation_meta (key, value) VALUES ('last_harvest', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [new Date().toISOString()],
  );
  await d1(
    `INSERT INTO situation_meta (key, value) VALUES ('harvest_status', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [JSON.stringify(status)],
  );
}

// ---------- main ----------

async function main(): Promise<void> {
  let projects: Project[] = [];
  try {
    projects = parseProjects();
    status.projects = { ok: true, count: projects.length };
  } catch (e) {
    status.projects = { ok: false, count: 0, error: String(e) };
    console.error("FATAL: cannot parse PROJECTS.md —", e);
    process.exit(1);
  }

  let events: Ev[] = [];
  let nextBySlug = new Map<string, string[]>();

  try {
    const g = await gitEvents(projects);
    events.push(...g.events);
    status.git = { ok: true, count: g.events.length, note: `${g.mapped} repos mapped; unmapped: ${g.unmappedRepos.join(", ") || "none"}` };
  } catch (e) {
    status.git = { ok: false, count: 0, error: String(e) };
  }

  try {
    const w = workEvents(projects);
    events.push(...w.events);
    status.work = { ok: true, count: w.events.length, note: `${w.mapped} sessions mapped, ${w.unmapped} unmapped` };
  } catch (e) {
    status.work = { ok: false, count: 0, error: String(e) };
  }

  try {
    const m = memoryEvents(projects);
    events.push(...m.events);
    nextBySlug = m.nextBySlug;
    status.memory = { ok: true, count: m.events.length, note: `${m.mapped} files mapped, ${m.unmapped} unmapped` };
  } catch (e) {
    status.memory = { ok: false, count: 0, error: String(e) };
  }

  await upsertAll(projects, events, nextBySlug);

  console.log("source    | ok    | events | note");
  console.log("----------+-------+--------+------------------------------------------");
  for (const [name, s] of Object.entries(status)) {
    console.log(
      `${name.padEnd(9)} | ${(s.ok ? "OK" : "FAIL").padEnd(5)} | ${String(s.count).padEnd(6)} | ${s.error ?? s.note ?? ""}`,
    );
  }
  const zeroSignal = projects.filter((p) => !events.some((e) => e.project_slug === p.slug));
  if (zeroSignal.length > 0) {
    console.log(`no-signal projects (will render as anomaly cards): ${zeroSignal.map((p) => p.slug).join(", ")}`);
  }

  const failed = Object.values(status).some((s) => !s.ok);
  console.log(failed ? "HARVEST PARTIAL (exit 1)" : "HARVEST OK");
  process.exit(failed ? 1 : 0);
}

await main();
