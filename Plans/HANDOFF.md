# Dashboard Single-Window Initiative — HANDOFF

> Resume guide for the next session. Read this first when you say "resume the dashboard work" or anything similar.
> Status as of 2026-05-21 session wrap-up.

## Trigger phrases to resume

- "Resume the dashboard work"
- "Continue the dashboard single window"
- "Where were we on voice ingest"
- "Back to fixing the four gaps"

## The vision (locked)

Dashboard is the **single window** into Yaron's work. Terminal is only for talking to PAI; everything else lives in the dashboard. Continuous push, sub-30s latency. Multi-device. Voice eventually moves into the dashboard. Edit-in-place eventually. Architecture must be *very, very solid*.

Full doc: `Plans/VISION.md` (with 6 locked decisions).

## Where each agent landed

- `Plans/AGENT_ARCHITECT.md` — full architecture (Pipe B + Pulse-as-capture-buffer recommendation). Reference design.
- `Plans/AGENT_FIRSTPRINCIPLES.md` — counter-argument that the whole stack is wrong (multi-tenant SaaS template for a one-user, one-machine product). **Conclusion: argument rejected** — multi-device access is a real requirement, so cloud-backed stack is justified.
- `Plans/AGENT_PLAN.md` — five-milestone path (M1 activity → M2 artifacts → M3 push → M4 voice → M5 edit-in-place).
- `Plans/REVIEW_GAPS.md` — solidity gaps found in the architect's design. Most important: **Neon serverless HTTP driver doesn't support LISTEN/NOTIFY** — SSE design needs Neon Pool driver OR Durable Object fan-out. Spike before building Phase 3.

## The four gaps that need fixing (mapped from live dashboard, 2026-05-21)

After actually opening the dashboard via Interceptor (not theorizing from SQL files), the real blockers are:

1. **Voice feed empty** — every page shows 0 messages. Most visible gap. **← In progress.**
2. **Stale memory** — all memory entries timestamped `2026-05-20 15:04`. Last batch sync yesterday. No live updates.
3. **Tickets unused** — every project shows 0 tickets. Real work not tracked.
4. **Home not operational** — onboarding welcome decks, not "what's happening today."

Plus secondary: **/skills page crashes Interceptor** (frontend bug, separate from the four gaps).

## Gap #1 — voice ingest status (IN PROGRESS)

### What shipped in commit `1cca112`

- `functions/api/voice/feed.ts` — GET, Cf Access user auth, returns last 200 `voice_samples` rows.
- `functions/api/voice/ingest.ts` — POST, `X-Voice-Ingest-Secret` header, inserts row (audio_url defaults to "" — text-only v1, no R2 yet).
- `src/components/voice/VoiceChannelProvider.tsx` — replaced dead WebSocket with 5s polling against `/api/voice/feed`.
- `src/components/voice/VoicePanel.tsx` — audio_url-dependent UI now conditional on a non-empty URL.

Plus in PAI repo (not this repo) — `~/.claude/PAI/TOOLS/PaiVoice/cli.ts` patched to POST after each enqueue.

### Secrets state

- **CF Pages secret `VOICE_INGEST_SECRET`** — set on `my-jarvis-dashboard-yaron`. Value: `1071b1e421c638249ff6887f2989449a6906d6e930ebc132`.
- **Local `~/.claude/.env`** — has `DASHBOARD_URL`, `VOICE_INGEST_SECRET`, `DASHBOARD_CF_ACCESS_CLIENT_ID`, `DASHBOARD_CF_ACCESS_CLIENT_SECRET`.
- **Cf Access service token `pai-voice-ingest`** — created 2026-05-21. Client ID `026581c5745ccadd02c902c30f78a9e0.access`. (Secret is in `~/.claude/.env`.)

### The blocker — Cf Access policy not yet recognizing the service token

Live curl test still returns 302 with `service_token_status: false` in the JWT payload. Meaning Cf Access doesn't yet see the request as authenticated by a service token attached to this app.

Likely cause: the Service Auth policy on the `my-jarvis-dashboard-yaron` app either wasn't saved, or was saved with an empty Include rule.

**Resolution steps for next session:**

1. Open Cloudflare Zero Trust → Access → Applications → `my-jarvis-dashboard-yaron` → Policies tab.
2. Verify two policies exist: (a) the existing email-allow for `aitheroad@gmail.com`, (b) a new policy with **Action = Service Auth** and Include rule = either **"Service Token = pai-voice-ingest"** or **"Any Access Service Token"**.
3. If the second policy is missing or its Include is empty, recreate it. The combo *must* be Action=Service Auth + Include populated with a token selector. With Action=Allow, the "Service Auth" selector is grayed out.
4. Save. Wait ~5s for propagation.
5. Test:
   ```
   curl -i -X POST https://my-jarvis-dashboard-yaron.pages.dev/api/voice/ingest \
     -H "Content-Type: application/json" \
     -H "X-Voice-Ingest-Secret: $VOICE_INGEST_SECRET" \
     -H "CF-Access-Client-Id: $DASHBOARD_CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $DASHBOARD_CF_ACCESS_CLIENT_SECRET" \
     -d '{"agent_name":"jarvis","text_content":"resume test","title":"RESUME"}'
   ```
   Expected: HTTP 201 with `{ok:true, id, created_at}`. If still 302 → the policy still isn't right.
6. Once 201: run `pai-voice "voice pipe live" --title "VERIFY"`. Open the dashboard. Confirm the message appears in the Voice Feed panel within 5s (the polling interval).
7. Mark Gap #1 done. Move to Gap #2.

## Gap #2 — stale memory (NOT STARTED)

Memory page renders all entries with `2026-05-20 15:04` timestamps. No incremental sync after that.

**Likely shape of the fix** (per architect's design, adapted to memory):

- New endpoint `functions/api/memory/ingest.ts` (same auth model as voice/ingest — service token + shared secret).
- Schema: `memories` table already exists per `008_dashboard_brain.sql` — verify shape before adding.
- Local watcher: tails `~/.claude/projects/-Users-yaronkra/memory/MEMORY.md` and the individual memory files, POSTs changes on file modification. Either a Pulse module or a standalone launchd job (per REVIEW_GAPS Tier 1 #4, the cleaner path is a separate launchd job — `~/.claude/PAI/TOOLS/DashboardForwarder/`).
- Idempotency: client-supplied `memory_uid` per row (sha256 of file path + content) — see REVIEW_GAPS Tier 1 #2.

## Gap #3 — tickets unused (NOT STARTED)

Open question: are tickets the right tracking primitive at all? Memory seems to be the system Yaron actually uses. Options:

- **Option A:** auto-create tickets from significant work events (e.g. when a HANDOFF.md is created, when a memory entry is added with `session log` type).
- **Option B:** de-emphasize tickets, build a richer project detail page that pulls from memory + artifacts.
- **Option C:** leave tickets alone, address in #4 (home redesign) by showing project status from other signals.

Worth a 5-minute discussion before designing.

## Gap #4 — home redesign (NOT STARTED)

Current `HomePage.tsx` shows welcome decks (Welcome / Architecture / Rick & Morty) + 4 install steps. Replace with operational dashboard:

- **Today widget:** today's voice messages, today's memory updates, today's artifacts (when M2 ships).
- **Active projects strip:** the 6 real projects with current status + last activity.
- **Recent activity:** unified stream of voice + memory + artifact events from last 24h.
- **Pinned focus:** the artifact Yaron was last looking at (when M2 ships).

Keep the install/welcome decks accessible but move them out of the default landing.

## Architectural decisions to lock before each next phase

- **Phase 1 (this work — voice ingest):** secret + service token approach. Done.
- **Phase 2 (memory ingest):** decide whether the local forwarder is one process for both voice and memory, or two. **Recommendation:** one process, multiple JSONL tails — fewer launchd jobs to manage.
- **Phase 3 (real-time push, eventually):** Neon Pool/WebSocket driver spike vs Durable Object fan-out. Open from REVIEW_GAPS Tier 1 #1.

## Files touched in this session — full list

In `my-jarvis-dashboard-yaron`:
- `Plans/VISION.md` (created)
- `Plans/AGENT_ARCHITECT.md` (created by Architect agent)
- `Plans/AGENT_FIRSTPRINCIPLES.md` (created by general-purpose agent via FirstPrinciples skill)
- `Plans/AGENT_PLAN.md` (created by Plan agent, written by me — agent had no Write tool)
- `Plans/REVIEW_GAPS.md` (created — solidity review of architect's design)
- `Plans/HANDOFF.md` (this file)
- `functions/api/voice/feed.ts` (created)
- `functions/api/voice/ingest.ts` (created)
- `src/components/voice/VoiceChannelProvider.tsx` (modified — WS → polling)
- `src/components/voice/VoicePanel.tsx` (modified — nullable audio_url)

In `~/.claude/`:
- `PAI/TOOLS/PaiVoice/cli.ts` (modified — POST to dashboard after enqueue)
- `.env` (added DASHBOARD_URL, VOICE_INGEST_SECRET, DASHBOARD_CF_ACCESS_CLIENT_ID, DASHBOARD_CF_ACCESS_CLIENT_SECRET)
