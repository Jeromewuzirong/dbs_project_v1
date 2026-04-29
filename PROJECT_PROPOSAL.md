# Project Proposal: Kitchen Orchestrator

## One-Line Description
A real-time kitchen coordination system that uses backward scheduling to synchronize multi-step dishes across stations so every plate for a table lands at the same time.

## The Problem
During peak hours, restaurant kitchens rely on paper tickets and verbal communication to coordinate orders across multiple stations. Dishes from the same table routinely come out at different times — a salad sits wilting while the steak finishes, or a pasta gets cold waiting for a side. There's no system telling cooks *when* to start each dish so everything converges. The expeditor (the person calling orders) is doing this math in their head, and it breaks down under load.

This is fundamentally a scheduling problem — the same class of problem found in manufacturing and logistics (job assignment, priority queuing, resource constraints, real-time coordination). A kitchen is a small factory. This project tackles the contained version first, with architecture that could scale to industrial scheduling.

## Target User
Two distinct roles in a restaurant kitchen:

1. **The expeditor / head chef** — sees a full dashboard of all active orders, station loads, and delay risks. Uses it to spot bottlenecks, re-prioritize tables, and intervene before food quality suffers.
2. **Line cooks at each station** — see only their own queue: what to cook next, a countdown to when each step should start, and a button to mark it done. No noise from other stations.

The expeditor sees the whole system. Each cook sees only their slice.

## Core Features (v1)

### 1. Multi-Step Dish Scheduling Engine
Each dish is modeled as a sequence of steps, where each step belongs to a station and has an estimated duration. The engine backward-schedules from a computed `target_serve_time` so all dishes for a table converge:

- **`fire_at`** — the computed timestamp when a step should **start**
- **`ready_at`** — the computed timestamp when a step should be **complete**
- **Invariant**: `ready_at = fire_at + estimated_duration`

Example — Table 7 orders a Ribeye (4 steps), Pasta (3 steps), and Salad (2 steps):

```
Order (Table 7) — target_serve_time: 7:00
 ├── Ribeye
 │    ├── Sear (Grill, fire_at 0:00 → ready_at 3:00)
 │    ├── Rest (Plating, fire_at 3:00 → ready_at 5:00)
 │    ├── Sauce (Sauté, fire_at 5:00 → ready_at 6:00)
 │    └── Plate (Plating, fire_at 6:00 → ready_at 7:00)
 ├── Pasta
 │    ├── Boil (Sauté, fire_at 2:00 → ready_at 5:00)
 │    ├── Toss (Sauté, fire_at 5:00 → ready_at 6:00)
 │    └── Plate (Plating, fire_at 6:00 → ready_at 7:00)
 └── Salad
      ├── Prep (Cold, fire_at 5:00 → ready_at 6:30)
      └── Plate (Plating, fire_at 6:30 → ready_at 7:00)
```

The scheduling engine re-runs on every state change (step completed, step delayed, new order, manual override), continuously adjusting the plan.

### 2. Soft vs. Hard Delay Handling
- **Soft delay**: A step runs over, but the dish still finishes within tolerance of `target_serve_time`. System adjusts downstream steps for that dish only. Dashboard shows **yellow** warning.
- **Hard delay**: A step delay pushes a dish past `target_serve_time`, breaking table synchronization. System pushes `target_serve_time` forward and reschedules all not-yet-started steps for every dish on that table. Dashboard shows **red** alert with delay magnitude. Steps already in progress are never interrupted.

### 3. Cook Station View
Each station displays a filtered, ordered queue showing only that station's steps:
- Countdown timer per step: "Start in 3:24" → "**START NOW**" → "Cooking… 2:15 / 3:00"
- Tap to mark a step as started or completed
- Flag button to signal a delay before completion
- Countdowns are derived from server-side `fire_at` — no client-side scheduling

### 4. Expeditor Dashboard
Full kitchen overview on a tablet or mounted screen:
- All active orders as timeline cards with per-step progress
- Color-coded delay status: green (on track), yellow (soft delay), red (hard delay / sync broken)
- **Station health sidebar**: per-station average delay, queue depth, and delay rate — surfaces bottlenecks at a glance (e.g., "Grill: avg +2.3min behind, 8 items queued")
- Tap to manually re-prioritize a table or override target serve time

### 5. Simulation Mode
Auto-generates realistic order streams for demo and stress testing — no real kitchen needed:

| Preset | Orders/min | Burst Chance | Delay Chance | Purpose |
|--------|-----------|--------------|--------------|---------|
| Steady | 1 | 0% | 0% | Baseline — shows clean scheduling |
| Dinner Rush | 3 | 30% | 20% | Shows system value under pressure |
| Chaos | 5 | 50% | 40% | Stress test — hard delays, cascading reschedules |

Simulated cooks auto-complete steps with optional random delay injection. The dashboard works identically whether orders come from simulation or manual input.

## Tech Stack
- **Frontend**: Next.js (App Router) — handles both the UI and server-side scheduling logic in API routes
- **Styling**: Tailwind CSS — fast iteration on the two distinct views (cook vs. expeditor)
- **Database**: Supabase (Postgres) — relational model fits the order/item/step hierarchy; Supabase Realtime is the key enabler for instant cross-client updates without a separate WebSocket server
- **Auth**: None for v1 — cooks select their station from a dropdown, expeditor opens the dashboard view. No login required.
- **APIs**: None — fully self-contained. All data (stations, menu items, recipes) is seeded into Supabase. No external dependencies means nothing breaks during a demo.
- **Deployment**: Vercel — pairs naturally with Next.js, zero-config deploys
- **MCP Servers**: Supabase MCP (database schema management and seed data), Playwright MCP (end-to-end testing of real-time flows across multiple browser tabs simulating different stations)

### Real-Time Architecture
All scheduling computation happens **server-side** in Next.js API routes. Clients only report state changes and receive computed schedules — they never calculate `fire_at` or `ready_at`.

```
Cook taps "Done"
  → POST /api/steps/[id]/complete
  → API route acquires Postgres advisory lock for that order
  → Updates step status, runs reschedule() within a single transaction
  → Writes updated fire_at/ready_at for all affected steps
  → Transaction commits → lock released
  → Supabase Realtime pushes changes to subscribed clients
  → All screens update instantly
```

Postgres advisory locks (`pg_advisory_xact_lock`) scoped per order prevent race conditions when multiple cooks complete steps simultaneously for the same table.

## Stretch Goals
- **Estimated cook time learning**: Track `actual_duration` vs `estimated_duration` over time, and auto-adjust estimates per dish/station
- **Kitchen analytics dashboard**: Historical throughput, peak hour patterns, per-station performance trends
- **Menu management UI**: Add/edit dishes and their step sequences without touching SQL
- **Multi-kitchen support**: Separate scheduling contexts for different restaurant locations
- **Ticket printer integration**: Output physical tickets alongside the digital views
- **Voice callouts**: Text-to-speech for "fire" calls on the cook's station view
- **Mobile-native cook view**: React Native app optimized for greasy hands and small screens
- **Industrial generalization**: Abstract the scheduling engine into a generic job-shop scheduler that could handle manufacturing or logistics workflows

## Biggest Risk
**The scheduling engine becoming a complexity trap.** In theory, re-computing staggered start times on every state change is straightforward. In practice, with 15+ active orders across 4-5 stations, cascading delays can create thrashing — the system keeps re-adjusting and never settles. The multi-step dish model adds another dimension of complexity (cross-station dependencies per dish, not just per table).

**Secondary risk**: Real-time sync under load. If 5 cooks tap "done" simultaneously for dishes on the same table, the advisory lock serialization must hold up without introducing perceptible UI lag.

**Mitigation**: Start with a simplified scheduling engine (earliest-deadline-first, no cascading) and get the full UI loop working end-to-end in week 1. Layer in soft/hard delay logic in week 3 only after the foundation is solid. Stress-test Supabase Realtime with concurrent updates in week 2 before building too much on top of it.

## Week 5 Goal
A live demo running the **Dinner Rush** simulation preset: orders streaming in at 3/min with occasional bursts and random delays. The expeditor dashboard shows orders flowing through stations in real time, soft delays turning dishes yellow, a hard delay triggering a table-wide reschedule with the timeline visibly shifting, and the station health sidebar highlighting the grill as a bottleneck. Switch to a cook's station view to show their focused queue with countdowns ticking down and a "START NOW" step at the top. Total demo: ~5 minutes, fully self-running.
