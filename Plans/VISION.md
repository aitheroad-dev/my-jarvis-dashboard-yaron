# Dashboard Vision — Yaron's Single Window

> Draft 1 — 2026-05-21. The point of this doc: nail what this dashboard IS, so every architectural decision downstream serves it. Refine before spawning design agents.

## Operating premise

**The dashboard is the only window into my work.** I keep it open. I look at it. I work *through* it. I only return to the terminal to talk to PAI — write a message, get a response, then go back to the dashboard to see what came out.

Everything PAI and I do together — every document, every artifact, every change to a project, every voice message, every captured fact — surfaces in the dashboard. Continuously. Not as a daily report, not as a manual export. **As it happens.**

## What lives in the dashboard

1. **All artifacts I and PAI create together.** Documents, notes, plans, summaries, drafts. When PAI generates a doc, I don't open it in Chrome or Safari — I see it in the dashboard, with the previous and next docs one click away.
2. **All structured work.** Projects, goals, tickets, agents, skills, KB pages. Already there from the template.
3. **The activity stream.** What PAI just did, what tool fired, what session is running. The firehose of "what's happening on the machine."
4. **Voice.** The pai-voice feed and player live inside the dashboard, not on `localhost:31338` as a separate tab. I hear it from the dashboard.
5. **Memory.** Everything PAI remembers about me, browsable.

## What the terminal is for

**Talking to PAI.** That's it. The terminal is the conversation surface. Outputs from that conversation that matter — docs, plans, decisions — flow into the dashboard automatically.

## The continuity principle

This isn't a system I open once a day. **I'm in it all day.** Updates happen in seconds, not hours. The latency between "PAI made the thing" and "I see the thing in the dashboard" is short enough that I trust the dashboard as ground truth.

If the dashboard lags or batches, the principle breaks — I'll start opening files in Finder again. So the pipe has to be *push*, not poll-and-batch.

## Document browsing

When PAI creates a document, it doesn't go into a flat list. The dashboard should let me:

- Open it
- Move forward and back through documents by recency, by project, by topic
- See related artifacts (the session that produced it, the ticket it answers, the skill that ran)
- Re-open older docs without hunting through folders

## Voice inside

Voice events stream into a dashboard panel. The current `localhost:31338` player is the prototype; the dashboard absorbs it. I should be able to:

- See the current voice queue
- Replay any past voice message
- See which agent (jarvis / atlas / nova / rex) said what
- Pause, scrub, color-coded by agent

## Out of scope (deliberately)

- **Editing in the dashboard.** For now, the dashboard is read-display + structured-work; document editing stays in code/markdown files. We can revisit, but I'm not building an Obsidian replacement.
- **Multi-user.** This is single-tenant for me. Cloudflare Access already enforces that.
- **Mobile-first.** Desktop browser. I'm at the machine all day.
- **Real-time collaboration.** Just me + PAI. No shared editing surface needed.

## The architectural question

The dashboard is on Cloudflare Pages, reading from Neon Postgres. Everything happens on this local machine. The pipe between "local event" and "dashboard row" is the open question — three candidates:

- **A.** Local sync agent writes directly to Neon via `DATABASE_URL`. Skips Cloudflare Access entirely. Fastest, simplest, machine-bound.
- **B.** Hooks POST to a dashboard `/api/events` endpoint via Cloudflare Access service token.
- **C.** Pulse (the existing local `localhost:31337` aggregator) becomes the hub and ships to dashboard.

Each has a different blast radius and a different operational story. The agents will weigh them.

## What I want the agents to think about

1. **Ideal state** — what does this dashboard look like once it's actually the single window? Be specific.
2. **Architecture** — what's the right pipe (A/B/C/something else) given the continuity principle?
3. **Plan** — concrete current-state → ideal-state path, in dependency order.

## What's already true

- Dashboard is live as a single-tenant fork (`my-jarvis-dashboard-yaron`, deployed via Cloudflare Pages).
- Auth is Cloudflare Access. Email `aitheroad@gmail.com` is the only allowed user.
- Schema has projects, goals, tickets, agents, skills, memories, mcp_activity, kb pages.
- Voice runs locally via `pai-voice` daemon at `localhost:31338` (separate from dashboard).
- Pulse runs locally at `localhost:31337` and already aggregates many event streams.
- Hooks already write to `MEMORY/OBSERVABILITY/*.jsonl` and `MEMORY/VOICE/voice-events.jsonl`. Capture is solved; piping is not.

## Locked decisions (2026-05-21)

- [x] **Scope:** Everything PAI and I create together reflects in the dashboard. Exactly right, not too broad.
- [x] **Latency:** Real-time push is a hard requirement. No 5-minute batching. When we finish creating something locally, it pushes immediately.
- [x] **Voice:** Eventually *move* into the dashboard and retire `localhost:31338`. Not the first milestone, but the end state. Until then: mirror is acceptable, but the path is one-way toward replacement.
- [x] **Editing:** Eventually edit-in-place inside the dashboard. Not first milestone, but a planned destination — agents should design for it, not against it.
- [x] **Multi-device access (added 2026-05-21 post-agent-review):** The dashboard must be reachable from other devices — phones, other laptops, when I'm not at this machine. This is a hard requirement, not aspirational. It rules out a local-only architecture (Pulse-with-a-better-UI). The cloud-backed stack (Cloudflare Pages + Neon Postgres + Cloudflare Access) is justified by this decision specifically.
- [x] **Solidity bar:** The architecture must be *very* solid. I need to trust that everything I'm doing is reflected in the dashboard, all the time. If the dashboard ever feels unreliable, the whole continuity principle breaks. Bias toward proven patterns, append-only event logs, idempotent ingest, observable failure modes.
