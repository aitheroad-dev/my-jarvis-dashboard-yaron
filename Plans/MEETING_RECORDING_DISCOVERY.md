# Meeting Recording — Approaches Discovery (2026-06-29)

> Triggered by Vexa's intermittent `401 "Invalid API key"` (valid key, flaky hosted auth — verified: same key returned `401·503·200×8`). Before fixing, we mapped the whole space. Verified by 4 parallel research streams + live inventory. Prices USD unless noted (~$1 = €0.92).

## What we already own (verified live)
- **Dashboard Meetings app** — Google Calendar OAuth → D1 `calendar_events` → `my-jarvis-calendar-cron` (every min) → dispatches a **Vexa** bot → transcript → D1 → `/meetings`. The *cloud, laptop-off, from-anywhere* product. Only the Vexa layer is outsourced/flaky.
- **`pai-meet`** — local capture (mic + system audio via BlackHole) → local Whisper (en/he/auto) → notes. Laptop-on, fully private, free.
- **`pai-tools` Worker** — hosted Whisper/TTS/OCR endpoints (live). Server-side transcription of any audio we supply.
- **`pai-cal`** — multi-account Google Calendar CLI (detection layer).

**Framing:** we built the entire skeleton (calendar detection, scheduling, storage, UI, AND two Whisper transcribers). The only outsourced job is *"get audio out of a live Meet/Zoom/Teams call, laptop-off."* The discovery is about the best engine for that one job.

## The master filter
Three hard requirements collapse the field fast:
1. **Hebrew + English** transcription (decisive — eliminates most incumbents and Google Meet native).
2. **Laptop-off / from-anywhere** (eliminates pure local capture as the *primary* path).
3. **API/webhook into our own Cloudflare dashboard** (eliminates walled-garden apps).

**Hebrew engine quality (verified ranking):** Gladia Solaria-1 (~7.5% WER, MeetingBaaS default) > Deepgram Nova-3 ≈ AssemblyAI Universal (Recall/Attendee) > **ivrit-ai fine-tuned Whisper** (strong, *self-hostable/local*) > base Whisper (Vexa) = moderate.

## Decision table

| Path | Laptop-off? Universal? | Calendar auto-join | Hebrew | Cost | Self-host / EU ownership | Effort | 
|---|---|---|---|---|---|---|
| **1. Keep Vexa-cloud + retry fix** | ✅ / ✅ any platform | ✅ ours (built) | base Whisper = moderate | **$0.50/hr or $12/mo** | self-host possible (Apache-2.0) but needs GPU | **~1h (just the fix)** |
| **2. Self-host Vexa** | ✅ / ✅ | ours | moderate (Whisper) | compute only | ✅ full, but **GPU box ~€180+/mo** for realtime | high (ops) |
| **3. Recall.ai** | ✅ / ✅ (widest: +Webex/GoTo) | ✅ **free, native** | good (Deepgram/AssemblyAI) | $0.65/hr | ❌ **no self-host ever**; EU residency selectable | low (swap vendor) |
| **4. MeetingBaaS** | ✅ / ✅ | ⚠️ **$299/mo Enterprise only** | **best (Gladia 7.5%)** | ~$0.44–0.63/hr + tier | on-prem = ~$10k/mo; EU (French co) | low vendor / high cost |
| **5. Attendee (hosted→self-host)** | ✅ / ✅ | ✅ native (docs) | good (Deepgram) | $0.50→0.35/hr | ⚠️ ELv2 (source-available, no-resell); self-host = your EU box, no GPU (Deepgram cloud) | medium |
| **6. Recorder-bot + our pipeline** ⭐ | ✅ / ✅ | **DIY via pai-cal** (we own it) | **ivrit-ai = best self-hostable** | **€0 API** + compute | ✅✅ **full EU ownership, our TS stack, MIT** | **high (build), but it's ours** |
| **7. Platform-native (Zoom Pro / Teams)** | ✅ / ❌ own meetings only | platform-native | Zoom ❌ / **Teams ✅** / Meet ❌ | Zoom Pro ~€13/mo; Teams API now **free** | EU add-on/tenant | medium (tenant + OAuth) |
| **8. Local `pai-meet`** | ❌ laptop-on / ✅ any | n/a | **ivrit-ai = strong** | €0 | ✅ nothing leaves Mac | already built |

**Hard truth (verified):** local capture can *never* be laptop-off. A headless capturer on the Hetzner box *is itself a bot* — "VPS local capture" collapses into path 6. Platform-native is the only genuine no-bot/no-laptop route, but only for meetings **you host** on a licensed account.

## Path 6 (the standout for Yaron) — how it works
`screenappai/meeting-bot` (MIT, TypeScript/Node/Playwright — *your stack*) on the Hetzner box: headless Chromium joins Meet/Zoom/Teams, records to WebM, uploads to **R2** + completion webhook. `pai-cal` watches Google Calendar → `POST /join` at start. Recorded file → **`pai-meet` + ivrit-ai Hebrew Whisper** (post-meeting; CPU fine, no GPU) → into the dashboard D1. Result: **zero vendor, MIT-licensed, full EU data ownership, best self-hostable Hebrew, no monthly API bill** — trade-off is *post-meeting* (not realtime) transcripts + we build/maintain the bot glue.

## Recommendation
- **Now (unblock, ~1h):** keep **Vexa + the transient-401/503 retry fix** — cheapest, removes the symptom today. (Path 1)
- **The real direction (fits "own complete systems" + EU + Hebrew):** prototype **Path 6** — recorder-bot + `pai-cal` + `pai-meet`/ivrit-ai. Kills the vendor, best Hebrew we can self-host, our stack, no bill. Build cost is real; output is post-meeting notes (fine for this use).
- **If you'd rather never run a bot:** **Recall.ai** (Path 3) is the reliability king — free native calendar auto-join, EU residency, good Hebrew — but no self-host, ever (conflicts with your eventual-sovereignty goal).
- **Skip:** MeetingBaaS (calendar paywalled at $299/mo), Skribby (no calendar), Symbl (no bot), Otter/Fathom/Read.ai/Granola (no Hebrew). Platform-native Teams is a nice *supplement* for your own hosted Hebrew meetings, not a universal replacement.

## Sources
Bot-APIs: recall.ai/pricing · meetingbaas.com · attendee.dev · vexa.ai/pricing · skribby.io. OSS: github.com/Vexa-ai/vexa · github.com/attendee-labs/attendee · github.com/screenappai/meeting-bot. Incumbents: fireflies.ai · tldv.io · otter.ai · fathom.ai · granola.ai. Platform-native: developers.zoom.us · developers.google.com/workspace/meet/api · learn.microsoft.com graph transcripts. Hebrew: gladia.io hebrew · deepgram nova-3 hebrew · huggingface ivrit-ai. (Full per-claim sources + confidence tags in the 2026-06-29 research transcripts.)
