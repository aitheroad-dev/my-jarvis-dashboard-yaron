#!/usr/bin/env bun
/**
 * upload-voice-r2.ts — bulk-upload the voice backlog MP3s to R2.
 *
 * Spawns `wrangler r2 object put` per file via Bun.spawn with piped stdio, so
 * wrangler's ink UI streams into a captured pipe and never corrupts the parent
 * shell (the reason a plain shell loop of `r2 object put` breaks). Concurrency-
 * limited. Reads sql/d1/voice_upload_manifest.tsv (from reingest-voice.ts).
 *
 * Env: CLOUDFLARE_API_TOKEN.  Optional arg: a number to limit (smoke test).
 */
import { readFileSync, existsSync } from "node:fs";

const BUCKET = "mjd-yaron-voice";
const WRANGLER = "./node_modules/wrangler/bin/wrangler.js";
const CONC = 6;

const limitArg = process.argv.find((a) => /^\d+$/.test(a));
const limit = limitArg ? Number(limitArg) : Infinity;

const lines = readFileSync("sql/d1/voice_upload_manifest.tsv", "utf8")
  .trim()
  .split("\n")
  .slice(0, limit);

let done = 0;
let fail = 0;
let cursor = 0;

async function uploadOne(id: string, path: string): Promise<void> {
  if (!existsSync(path)) {
    fail++;
    return;
  }
  const proc = Bun.spawn(
    [
      "node", WRANGLER, "r2", "object", "put", `${BUCKET}/${id}.mp3`,
      "--file", path, "--content-type", "audio/mpeg",
    ],
    { env: { ...process.env, CI: "true" }, stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code === 0) done++;
  else {
    fail++;
    if (fail <= 3) console.error(`fail ${id}:`, (await new Response(proc.stderr).text()).slice(-200));
  }
}

async function worker(): Promise<void> {
  while (cursor < lines.length) {
    const idx = cursor++;
    const [id, path] = lines[idx].split("\t");
    await uploadOne(id, path);
    if ((done + fail) % 25 === 0) {
      console.log(`progress ${done + fail}/${lines.length} (ok=${done} fail=${fail})`);
    }
  }
}

await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`DONE uploaded ok=${done} fail=${fail} of ${lines.length}`);
