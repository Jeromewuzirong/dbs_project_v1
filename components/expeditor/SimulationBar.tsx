'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const PRESETS = {
  steady:      { label: 'Steady',      ordersPerMin: 1, delayChance: 0.00 },
  dinner_rush: { label: 'Dinner Rush', ordersPerMin: 3, delayChance: 0.20 },
  chaos:       { label: 'Chaos',       ordersPerMin: 5, delayChance: 0.40 },
} as const;

type PresetKey = keyof typeof PRESETS;

interface CatalogItem {
  id: string;
  name: string;
  totalDuration: number; // seconds — sum of all recipe step durations
}

export default function SimulationBar() {
  const [supabase]         = useState(() => createClient());
  const [open, setOpen]    = useState(false);
  const [preset, setPreset] = useState<PresetKey>('steady');
  const [running, setRunning] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // Refs: survive re-renders without triggering them; readable inside async callbacks.
  const runningRef    = useRef(false);
  const scheduledRef  = useRef(new Set<string>()); // step IDs already handed to a cook timeout
  const presetCfgRef  = useRef<typeof PRESETS[PresetKey]>(PRESETS.steady);
  const orderTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const cookPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lazy-load menu catalog the first time the panel is opened.
  useEffect(() => {
    if (!open || catalog !== null || loadingCatalog) return;

    setLoadingCatalog(true);
    Promise.all([
      supabase.from('menu_items').select('id, name'),
      supabase.from('recipe_steps').select('menu_item_id, estimated_duration'),
    ]).then(([{ data: items }, { data: steps }]) => {
      if (!items || !steps) return;

      const totals: Record<string, number> = {};
      for (const s of steps) {
        totals[s.menu_item_id] = (totals[s.menu_item_id] ?? 0) + s.estimated_duration;
      }

      setCatalog(
        items
          .filter(m => (totals[m.id] ?? 0) > 0)
          .map(m => ({ id: m.id, name: m.name, totalDuration: totals[m.id] })),
      );
    }).finally(() => setLoadingCatalog(false));
  }, [open, catalog, loadingCatalog, supabase]);

  // Schedule one step through the simulated cook pipeline.
  const scheduleStep = useCallback((
    id: string,
    estimatedDuration: number,
    delayChance: number,
  ) => {
    // Simulate the cook noticing the fired ticket (0–3 s).
    setTimeout(async () => {
      if (!runningRef.current) return;
      const startRes = await fetch(`/api/steps/${id}/start`, { method: 'POST' });
      console.log(`[sim] start  step ${id} → ${startRes.status}`);
      // 409 means the step was already started by someone else — that's fine.
      if (!startRes.ok && startRes.status !== 409) return;

      const extraMs  = Math.random() < delayChance ? (30 + Math.random() * 60) * 1000 : 0;
      const cookMs   = estimatedDuration * 1000 + extraMs;
      console.log(`[sim] scheduled completion for step ${id} in ${(cookMs / 1000).toFixed(1)}s`);

      setTimeout(async () => {
        if (!runningRef.current) return;
        console.log(`[sim] complete step ${id} — calling POST /api/steps/${id}/complete`);
        const completeRes = await fetch(`/api/steps/${id}/complete`, { method: 'POST' });
        console.log(`[sim] complete step ${id} → ${completeRes.status}`);
        // 409/404 = already completed or not found — silently ignored.
        scheduledRef.current.delete(id);
      }, cookMs);
    }, Math.random() * 3000);
  }, []);

  // Poll for fired steps and overdue pending steps, hand each to a simulated cook.
  const pollFiredSteps = useCallback(async () => {
    if (!runningRef.current) return;

    const now = new Date().toISOString();

    const [{ data: firedData, error: firedErr }, { data: overdueData, error: overdueErr }] =
      await Promise.all([
        supabase.from('order_steps').select('id, estimated_duration').eq('status', 'fired'),
        supabase.from('order_steps').select('id, estimated_duration').eq('status', 'pending').lte('fire_at', now),
      ]);

    const steps = [...(firedData ?? []), ...(overdueData ?? [])];
    console.log(
      '[sim] poll — actionable steps:', steps.length,
      `(fired: ${firedData?.length ?? 0}, overdue pending: ${overdueData?.length ?? 0})`,
      firedErr || overdueErr ? `errors: ${firedErr?.message} ${overdueErr?.message}` : '',
    );

    for (const step of steps) {
      if (scheduledRef.current.has(step.id)) continue;
      scheduledRef.current.add(step.id);
      scheduleStep(step.id, step.estimated_duration, presetCfgRef.current.delayChance);
    }
  }, [supabase, scheduleStep]);

  // Create one order with 1–3 random menu items.
  const createOrder = useCallback(async (items: CatalogItem[]) => {
    if (!runningRef.current) return;

    const shuffled = [...items].sort(() => Math.random() - 0.5);
    const count    = 1 + Math.floor(Math.random() * 3);
    const picked   = shuffled.slice(0, count);

    const maxDuration     = Math.max(...picked.map(m => m.totalDuration));
    const targetServeTime = new Date(Date.now() + (maxDuration + 10) * 1000).toISOString();
    const tableNumber     = 1 + Math.floor(Math.random() * 20);

    await fetch('/api/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        table_number:      tableNumber,
        target_serve_time: targetServeTime,
        items:             picked.map(m => m.id),
      }),
    }).catch(() => { /* swallow — don't crash the generator loop */ });
  }, []);

  function handleStart() {
    console.log('sim: start called');
    if (!catalog || catalog.length === 0 || running) return;
    const items = catalog; // narrowed to non-null by the check above

    presetCfgRef.current = PRESETS[preset];
    runningRef.current   = true;
    setRunning(true);

    const intervalMs = (60 / presetCfgRef.current.ordersPerMin) * 1000;

    // Fire one order immediately, then on the interval.
    createOrder(items);
    orderTimer.current    = setInterval(() => createOrder(items), intervalMs);
    cookPollTimer.current = setInterval(() => {
      console.log('sim: interval tick');
      pollFiredSteps();
    }, 2000);
  }

  function handleStop() {
    runningRef.current = false;
    setRunning(false);
    scheduledRef.current.clear();
    if (orderTimer.current)    clearInterval(orderTimer.current);
    if (cookPollTimer.current) clearInterval(cookPollTimer.current);
  }

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (orderTimer.current)    clearInterval(orderTimer.current);
      if (cookPollTimer.current) clearInterval(cookPollTimer.current);
    };
  }, []);

  return (
    <div className="border-b border-gray-800 bg-gray-950 shrink-0">

      {/* Toggle row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-2 text-xs hover:bg-gray-900 transition-colors"
      >
        <span className="flex items-center gap-2 text-gray-500">
          <span className="tabular-nums">{open ? '▾' : '▸'}</span>
          <span className="font-semibold uppercase tracking-wider">Simulation</span>
          {running && (
            <span className="text-green-400 font-semibold">
              · Running — {PRESETS[preset].label}
            </span>
          )}
        </span>
        {!running && (
          <span className="text-gray-700 italic">Idle</span>
        )}
      </button>

      {/* Expanded controls */}
      {open && (
        <div className="px-6 pb-3 flex items-center gap-3 flex-wrap">
          {loadingCatalog && (
            <span className="text-xs text-gray-500">Loading catalog…</span>
          )}

          {!loadingCatalog && catalog !== null && (
            <>
              {(Object.keys(PRESETS) as PresetKey[]).map(key => (
                <button
                  key={key}
                  disabled={running}
                  onClick={() => setPreset(key)}
                  className={[
                    'px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                    preset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white',
                    running ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  {PRESETS[key].label}
                  <span className="ml-1 opacity-60">
                    {PRESETS[key].ordersPerMin}/min
                    {PRESETS[key].delayChance > 0
                      ? ` · ${PRESETS[key].delayChance * 100}% delay`
                      : ''}
                  </span>
                </button>
              ))}

              <div className="flex-1" />

              {running ? (
                <button
                  onClick={handleStop}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-red-700 hover:bg-red-600 text-white transition-colors"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  className="px-4 py-1.5 rounded text-xs font-bold bg-green-700 hover:bg-green-600 text-white transition-colors"
                >
                  ▶ Start
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
