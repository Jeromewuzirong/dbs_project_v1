import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

// One tick of the auto-mode dispatcher.
// Called by the dashboard client every 2 s so the dispatcher runs
// server-side and survives page navigation.
//
// Tick logic:
//   1. Complete any in_progress steps whose simulated cook time has elapsed
//      (elapsed = started_at + estimated_duration * 100 ms ≤ now)
//   2. Re-read in_progress state (after completions fire next steps)
//   3. Assign idle chefs to fired/pending candidates, one per dish per tick

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;

  // ── 1. Complete elapsed in_progress steps ────────────────────────────────
  const { data: inProgress } = await adminClient
    .from('order_steps')
    .select('id, started_at, estimated_duration')
    .eq('status', 'in_progress');

  const now = Date.now();
  const toComplete = (inProgress ?? []).filter(s => {
    if (!s.started_at) return false;
    return now >= new Date(s.started_at).getTime() + s.estimated_duration * 100;
  });

  // Run completions sequentially to avoid concurrent reschedule races on the
  // same order (the complete route updates fire_at/ready_at for all siblings).
  for (const s of toComplete) {
    await fetch(`${origin}/api/steps/${s.id}/complete`, { method: 'POST' }).catch(() => {});
  }

  // ── 2. Re-read state after completions (next steps may now be fired) ─────
  const [{ data: nowInProgress }, { data: rawCandidates }, { data: chefsData }] =
    await Promise.all([
      adminClient
        .from('order_steps')
        .select('assigned_chef_id, order_item_id')
        .eq('status', 'in_progress'),
      adminClient
        .from('order_steps')
        .select('id, station_id, order_item_id, estimated_duration, step_number')
        .in('status', ['fired', 'pending'])
        .order('step_number', { ascending: true }),
      adminClient
        .from('chefs')
        .select('id, name, chef_stations(station_id)'),
    ]);

  const busyChefIds = new Set<string>();
  const busyDishIds = new Set<string>();
  for (const row of nowInProgress ?? []) {
    if (row.assigned_chef_id) busyChefIds.add(row.assigned_chef_id);
    busyDishIds.add(row.order_item_id);
  }

  type Chef = { id: string; name: string; stationIds: string[] };
  const chefs: Chef[] = (chefsData ?? [])
    .filter(c => (c.chef_stations as { station_id: string }[]).length > 0)
    .map(c => ({
      id:         c.id,
      name:       c.name,
      stationIds: (c.chef_stations as { station_id: string }[]).map(cs => cs.station_id),
    }));

  // Filter out dishes that already have a step in_progress.
  const candidates = (rawCandidates ?? []).filter(s => !busyDishIds.has(s.order_item_id));

  if (candidates.length === 0 || chefs.length === 0) {
    return NextResponse.json({ completed: toComplete.length, started: 0 });
  }

  // ── 3. Assign idle chefs to candidates ───────────────────────────────────
  const startedDishIds  = new Set<string>(); // within-tick dedup
  const assignedThisTick = new Set<string>();
  let started = 0;

  for (const step of candidates) {
    // Another step of this dish was assigned earlier in this tick.
    if (startedDishIds.has(step.order_item_id)) continue;

    const eligible = chefs.filter(c =>
      c.stationIds.includes(step.station_id) &&
      !busyChefIds.has(c.id) &&
      !assignedThisTick.has(c.id),
    );
    if (eligible.length === 0) continue;

    const chef = eligible[Math.floor(Math.random() * eligible.length)];

    const { error: startErr } = await adminClient
      .from('order_steps')
      .update({
        status:           'in_progress',
        started_at:       new Date().toISOString(),
        assigned_chef_id: chef.id,
      })
      .eq('id', step.id);

    if (!startErr) {
      busyChefIds.add(chef.id);
      assignedThisTick.add(chef.id);
      startedDishIds.add(step.order_item_id);
      started++;
    }
  }

  return NextResponse.json({ completed: toComplete.length, started });
}
