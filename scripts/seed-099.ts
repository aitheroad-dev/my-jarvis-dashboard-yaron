#!/usr/bin/env bun
/**
 * seed-099.ts — seed baseline rows into D1 from sql/099_seed.sql.
 *
 * The 099 seed is mostly large $T$...$T$::jsonb page_content bodies (KB
 * system-standards pages). Rather than translate the dollar-quoting to SQLite
 * by hand, this extracts each page and inserts it with a BOUND parameter — no
 * escaping, no ::jsonb cast. Also ensures the `life` project exists as the
 * container goals FK onto (a dashboard-native row with no PAI source).
 *
 * Env: CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN.
 */
import { readFileSync } from "node:fs";
import { getD1Sql } from "./_d1";

const SUBS: Record<string, string> = {
  "{{operator_name}}": "Yaron",
  "{{tenant_slug}}": "yaron",
  "{{operator_handle}}": "yaron",
  "{{neon_project_id}}": "yaron-d1",
  "{{r2_public_host}}": "pub-6fcd8a707615437da46fb97b8be570ba.r2.dev",
};
const sub = (s: string): string => {
  for (const [k, v] of Object.entries(SUBS)) s = s.split(k).join(v);
  return s;
};

const sql = getD1Sql();

// 1) life project — goals container (no PAI source; dashboard-native row).
await sql`INSERT INTO projects (slug, name, mission, status)
  VALUES ('life', 'Life', 'Top-level container for life goals (TELOS).', 'active')
  ON CONFLICT (slug) DO NOTHING`;
console.log("ensured 'life' project");

// 2) page_content KB pages — VALUES ( $T$slug$T$, $T$content$T$::jsonb )
const raw = readFileSync("sql/099_seed.sql", "utf8");
const re =
  /INSERT INTO page_content[\s\S]*?VALUES\s*\(\s*\$T\$([\s\S]*?)\$T\$\s*,\s*\$T\$([\s\S]*?)\$T\$::jsonb\s*\)/g;
let m: RegExpExecArray | null;
let pages = 0;
while ((m = re.exec(raw)) !== null) {
  const slug = sub(m[1]);
  const content = sub(m[2]);
  await sql`INSERT INTO page_content (page_slug, content) VALUES (${slug}, ${content})
    ON CONFLICT (page_slug) DO NOTHING`;
  pages++;
  console.log(`  page: ${slug}`);
}
console.log(`seeded ${pages} page_content rows`);
