#!/usr/bin/env bun
/**
 * reingest-voice.ts — rebuild the dashboard voice backlog on Cloudflare.
 *
 * Reads the local pai-voice durable outbox (~/Library/Caches/pai-voice/outbox.db)
 * and emits two artifacts (NO network):
 *   - sql/d1/voice_seed.sql            — voice_samples INSERTs (apply via wrangler d1 execute)
 *   - sql/d1/voice_upload_manifest.tsv — `<id>\t<local mp3 path>` for the R2 bulk upload
 *
 * Matches the ingest contract in functions/api/voice/ingest.ts:
 *   R2 object key = `<id>.mp3`, audio_url = `${PUBLIC}/<id>.mp3`, user_id = owner.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const HOME = process.env.HOME!;
const OUTBOX = `${HOME}/Library/Caches/pai-voice/outbox.db`;
const PUBLIC = "https://pub-6fcd8a707615437da46fb97b8be570ba.r2.dev";
const USER = "aitheroad@gmail.com";

const db = new Database(OUTBOX, { readonly: true });
const rows = db
  .query(
    "SELECT id, agent, voice, title, text, duration, created_at, audio_path FROM outbox ORDER BY created_at ASC",
  )
  .all() as Array<{
  id: string;
  agent: string | null;
  voice: string | null;
  title: string | null;
  text: string | null;
  duration: number | null;
  created_at: string | null;
  audio_path: string | null;
}>;

const q = (s: string | null): string =>
  s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'";

let sql = "-- voice_samples backlog re-ingest (generated from pai-voice outbox.db)\n";
const manifest: string[] = [];
let n = 0;
for (const r of rows) {
  if (!r.audio_path || !existsSync(r.audio_path)) continue; // only rows whose mp3 is on disk
  const dur = r.duration != null ? String(Math.round(r.duration)) : "NULL";
  const url = `${PUBLIC}/${r.id}.mp3`;
  sql +=
    `INSERT INTO voice_samples ` +
    `(id,user_id,agent_name,text_content,audio_url,title,duration_seconds,category,voice_id,created_at) VALUES (` +
    `${q(r.id)},${q(USER)},${q(r.agent || "ringo")},${q(r.text || "")},${q(url)},` +
    `${q(r.title)},${dur},'message',${q(r.voice)},${q(r.created_at)}) ` +
    `ON CONFLICT(id) DO NOTHING;\n`;
  manifest.push(`${r.id}\t${r.audio_path}`);
  n++;
}

await Bun.write("sql/d1/voice_seed.sql", sql);
await Bun.write("sql/d1/voice_upload_manifest.tsv", manifest.join("\n") + "\n");
console.log(`generated ${n} voice rows → sql/d1/voice_seed.sql (+ upload manifest)`);
