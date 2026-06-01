import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";

const sql = neon(process.env.EREZ_DB_URL!);
const OUT = "/Users/yaronkra/.claude/PAI/USER/BUSINESS/MY_JARVIS/Meetings";

function slugify(s: string): string {
  return (s || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60)
    || "untitled";
}

function dateStr(d: any): string {
  if (!d) return "0000-00-00";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

const meetings = await sql`
  SELECT id, title, meeting_url, bot_id, status, started_at, ended_at, created_at,
         (SELECT COUNT(*) FROM meeting_transcript t WHERE t.meeting_id = m.id) AS row_count
  FROM meetings m
  ORDER BY created_at ASC
`;

console.log(`FOUND ${meetings.length} meetings in Neon\n`);

let saved = 0, skipped = 0;
const empties: string[] = [];
const savedList: string[] = [];

for (const m of meetings) {
  const date = dateStr(m.started_at ?? m.created_at);
  const slug = slugify(m.title);
  const filename = `${date}_${slug}__id${m.id}.md`;
  const filepath = `${OUT}/${filename}`;

  if (Number(m.row_count) === 0) {
    empties.push(`#${m.id} ${date} "${m.title}" (status=${m.status})`);
    skipped++;
    continue;
  }

  const rows = await sql`
    SELECT speaker_name, words, start_ts, end_ts, event_type
    FROM meeting_transcript
    WHERE meeting_id = ${m.id}
    ORDER BY COALESCE(start_ts, 0), id
  `;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${(m.title ?? "Untitled").replace(/\n/g, " ")}`);
  lines.push(`meeting_id: ${m.id}`);
  lines.push(`bot_id: ${m.bot_id ?? "(none)"}`);
  lines.push(`status: ${m.status}`);
  lines.push(`started_at: ${m.started_at?.toISOString?.() ?? m.started_at ?? "(unknown)"}`);
  lines.push(`ended_at: ${m.ended_at?.toISOString?.() ?? m.ended_at ?? "(unknown)"}`);
  lines.push(`source: erez-dashboard Neon (project orange-sky-39481838)`);
  lines.push(`row_count: ${rows.length}`);
  if (m.meeting_url) lines.push(`meeting_url: ${m.meeting_url}`);
  lines.push("---");
  lines.push("");

  let currentSpeaker = "";
  for (const r of rows) {
    if (r.speaker_name && r.speaker_name !== currentSpeaker) {
      lines.push("");
      lines.push(`**${r.speaker_name}:**`);
      currentSpeaker = r.speaker_name;
    }
    lines.push(r.words);
  }

  writeFileSync(filepath, lines.join("\n"));
  savedList.push(`  ${date} #${m.id} ${rows.length}r → ${filename}`);
  saved++;
}

console.log("=== SAVED ===");
for (const s of savedList) console.log(s);
console.log(`\n=== SKIPPED (empty transcripts, ${empties.length}) ===`);
for (const e of empties) console.log(`  ${e}`);
console.log(`\nTOTAL: saved=${saved} skipped=${skipped} of ${meetings.length}`);
