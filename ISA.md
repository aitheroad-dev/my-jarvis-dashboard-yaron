---
project: my-jarvis-dashboard-yaron
task: Standalone cloud meetings app — agent joins + transcribes, laptop-independent
slug: dashboard-meetings-app
effort: E4
phase: think
progress: 0/0
mode: standard
started: 2026-06-11T10:15:00+02:00
updated: 2026-06-11T10:55:00+02:00
---

# Dashboard Meetings App — ISA

> Prior task (situation-board, 48/48 complete) archived in git at `61215f9`.
> **PIVOT 2026-06-11 ~10:45** — Yaron: the local pai-meet system was a *reference only*. The dashboard meetings app must be fully cloud-standalone. Local-bridge build (Pulse module) was completed through curl-ready state, then rolled back cleanly on his instruction.

## Problem

The dashboard's Meetings page is an unwired shell: the UI and D1 schema (meetings, meeting_transcript, meeting_actions) shipped with the template, but Yaron's Pages project has none of the `MEETINGS_WORKER_URL/TENANT_KEY/TENANT_SLUG` bindings, no tenant registered on the shared My Jarvis meetings Worker, and — since the Neon→D1 migration — no path for transcript segments to land in his database at all (the Neon-era worker wrote tenant Postgres directly). There is no way to create a meeting, send an agent into it, or read a transcript without Yaron's laptop.

## Vision

From any device, anywhere — laptop off — open the Meetings page, paste a meeting link (or create one), and an agent joins the call, listens, and transcribes. The transcript and summary appear in the dashboard as the meeting happens and stay forever. The system is so self-contained that Yaron's sister could be handed access and run her own meetings with it, without Yaron in the loop.

## Out of Scope

- Local recording of in-person/this-Mac audio (pai-meet keeps that job; explicitly disconnected from this app).
- Anything that requires Yaron's Mac to be powered on for the pipeline to work.
- Editing/deleting meetings from the UI (v2).
- Full multi-tenant provisioning product flow (sister-shareability informs the design; her onboarding is its own task).

## Constraints

- Entirely cloud-resident: Cloudflare-first (Pages Functions + D1 + R2 + Workers) per the platform-consolidation decision.
- Hebrew + English transcription are both required (his meetings are mostly Hebrew).
- Transcript ingest must write his D1 — requires an authenticated ingest endpoint in his own `functions/` (external workers cannot reach D1 directly).
- Dashboard deploy = wrangler direct-upload via node; pre-push gate `typecheck && lint && build`.
- TS everywhere; bun for tooling.
- Bot-service choice pending vendor research + Yaron's call (see Decisions) — architecture ISCs written after that decision.

## Goal

A meeting created in the dashboard from any device causes a cloud agent to join the call and stream its transcript into Yaron's D1, visible live and permanently on the Meetings page — with zero dependency on any local machine.

## Criteria

> Authored after the bot-backend decision (see Decisions, OPEN item). The superseded local-bridge criteria set (35 ISCs, none verified) was retired wholesale with the pivot — git history preserves it.

## Decisions

- 2026-06-11 10:15 — [SUPERSEDED by pivot] Local bridge = Pulse module at `/api/meet`; built, curl-stage tested, then **rolled back** when Yaron clarified the system must be laptop-independent. Pulse restored to pre-task state (health 200 verified post-revert).
- 2026-06-11 10:55 — Pivot recorded: cloud-standalone, agent-joins-the-call architecture. Local pai-meet was reference material only, stays untouched and disconnected.
- 2026-06-11 10:55 — Facts established: shared My Jarvis meetings Worker is live (`my-jarvis-meetings-worker.myjarvis.workers.dev`); Yaron's Pages project lacks all three `MEETINGS_*` bindings; no transcript-ingest endpoint exists in his `functions/`; D1 meetings schema already present (`sql/d1/schema.sql`).
- 2026-06-11 10:55 — OPEN (Yaron's call, options researched in background): (A) register tenant on the shared company Worker + add D1 ingest endpoint — needs Erez coordination; (B) own meetings Worker on his CF account + hosted bot API (Vexa Cloud or similar) — fully self-owned, new vendor cost; (C) self-host bot stack (Vexa/Attendee) on Hetzner — independent but heaviest ops. Criteria authored after this lands.
- 2026-06-11 10:55 — E4 per classifier on the pivot; Cato audit binds at VERIFY once build happens.
