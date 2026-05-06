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
  const [supabase]              = useState(() => createClient());
  const [open, setOpen]         = useState(false);
  const [preset, setPreset]     = useState<PresetKey>('steady');
  const [ordersRunning, setOrdersRunning]   = useState(false);
  const [kitchenRunning, setKitchenRunning] = useState(false);
  const [catalog, setCatalog]   = useState<CatalogItem[] | null>(null);
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
      if (!startRes.ok && startRes.status !== 409) {
        scheduledRef.current.delete(id); // release so the next poll can retry
        return;
      }

      const extraMs  = Math.random() < delayChance ? (30 + Math.random() * 60) * 100 : 0;
      const cookMs   = estimatedDuration * 100 + extraMs;
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

  // Greedy cook poll: pick up any pending or fired step whose station is free
  // (no in_progress step at the same station for the same order).
  const pollFiredSteps = useCallback(async () => {
    if (!runningRef.current) return;

    const [{ data: actionableData }, { data: inProgressData }] = await Promise.all([
      supabase
        .from('order_steps')
        .select('id, step_number, estimated_duration, station_id, order_items!inner(order_id)')
        .in('status', ['pending', 'fired'])
        .order('step_number', { ascending: true }),
      supabase
        .from('order_steps')
        .select('station_id, order_items!inner(order_id)')
        .eq('status', 'in_progress'),
    ]);

    // Build set of order_id:station_id pairs already occupied by an in-progress step.
    const busy = new Set<string>();
    for (const s of inProgressData ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderId = (s.order_items as any)?.order_id;
      if (orderId) busy.add(`${orderId}:${s.station_id}`);
    }

    let newlyScheduled = 0;
    for (const step of actionableData ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderId = (step.order_items as any)?.order_id;
      if (!orderId) continue;
      const key = `${orderId}:${step.station_id}`;
      if (busy.has(key)) continue;
      if (scheduledRef.current.has(step.id)) continue;
      // Mark busy immediately so we don't double-schedule this slot in the same cycle.
      busy.add(key);
      scheduledRef.current.add(step.id);
      scheduleStep(step.id, step.estimated_duration, presetCfgRef.current.delayChance);
      newlyScheduled++;
    }

    console.log(
      `[sim] poll — actionable: ${actionableData?.length ?? 0}`,
      `in_progress: ${inProgressData?.length ?? 0}`,
      `newly scheduled: ${newlyScheduled}`,
    );
  }, [supabase, scheduleStep]);

  // Create one order with 1–3 random menu items.
  const createOrder = useCallback(async (items: CatalogItem[]) => {
    if (!runningRef.current) return;

    const { count: activeCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'active']);
    if ((activeCount ?? 0) >= 6) return;

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
    if (!catalog || catalog.length === 0 || ordersRunning || kitchenRunning) return;
    const items = catalog;

    presetCfgRef.current = PRESETS[preset];
    runningRef.current   = true;
    setOrdersRunning(true);
    setKitchenRunning(true);

    const intervalMs = (60 / presetCfgRef.current.ordersPerMin) * 1000;

    createOrder(items);
    orderTimer.current    = setInterval(() => createOrder(items), intervalMs);
    cookPollTimer.current = setInterval(() => {
      console.log('sim: interval tick');
      pollFiredSteps();
    }, 2000);
  }

  function handleStopOrders() {
    setOrdersRunning(false);
    if (orderTimer.current) clearInterval(orderTimer.current);
    orderTimer.current = null;
  }

  function handleStopKitchen() {
    runningRef.current = false;
    setOrdersRunning(false);
    setKitchenRunning(false);
    scheduledRef.current.clear();
    if (orderTimer.current)    clearInterval(orderTimer.current);
    if (cookPollTimer.current) clearInterval(cookPollTimer.current);
    orderTimer.current    = null;
    cookPollTimer.current = null;
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
          {kitchenRunning && (
            <span className={`font-semibold ${ordersRunning ? 'text-green-400' : 'text-amber-400'}`}>
              · {ordersRunning ? 'Running' : 'Draining'} — {PRESETS[preset].label}
            </span>
          )}
        </span>
        {!kitchenRunning && (
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
                  disabled={ordersRunning || kitchenRunning}
                  onClick={() => setPreset(key)}
                  className={[
                    'px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                    preset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white',
                    (ordersRunning || kitchenRunning) ? 'opacity-40 cursor-not-allowed' : '',
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

              {kitchenRunning ? (
                <div className="flex gap-2">
                  {ordersRunning && (
                    <button
                      onClick={handleStopOrders}
                      className="px-4 py-1.5 rounded text-xs font-bold bg-amber-700 hover:bg-amber-600 text-white transition-colors"
                    >
                      ■ Stop Orders
                    </button>
                  )}
                  <button
                    onClick={handleStopKitchen}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-red-700 hover:bg-red-600 text-white transition-colors"
                  >
                    ■ Stop Kitchen
                  </button>
                </div>
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
