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
  totalDuration: number;
}

export default function SimulationBar() {
  const [supabase]          = useState(() => createClient());
  const [open, setOpen]     = useState(false);
  const [preset, setPreset] = useState<PresetKey>('steady');
  const [ordersRunning, setOrdersRunning] = useState(false);
  const [autoMode,      setAutoMode]      = useState(false);
  const [catalog, setCatalog]             = useState<CatalogItem[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [existingOrderCount, setExistingOrderCount] = useState<number | null>(null);

  const runningRef       = useRef(false);
  const scheduledRef     = useRef(new Set<string>());
  const presetCfgRef     = useRef<typeof PRESETS[PresetKey]>(PRESETS.steady);
  const stationChefsRef  = useRef<Record<string, string[]>>({});
  const orderTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const cookPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open || catalog !== null || loadingCatalog) return;

    setLoadingCatalog(true);
    Promise.all([
      supabase.from('menu_items').select('id, name'),
      supabase.from('recipe_steps').select('menu_item_id, estimated_duration'),
      supabase.from('chef_stations').select('chef_id, station_id'),
    ]).then(([{ data: items }, { data: steps }, { data: chefStations }]) => {
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
      const map: Record<string, string[]> = {};
      for (const cs of chefStations ?? []) {
        if (!map[cs.station_id]) map[cs.station_id] = [];
        map[cs.station_id].push(cs.chef_id);
      }
      stationChefsRef.current = map;
    }).finally(() => setLoadingCatalog(false));
  }, [open, catalog, loadingCatalog, supabase]);

  const scheduleStep = useCallback((
    id: string,
    estimatedDuration: number,
    delayChance: number,
    stationId: string,
  ) => {
    setTimeout(async () => {
      if (!runningRef.current) { scheduledRef.current.delete(id); return; }
      const chefIds = stationChefsRef.current[stationId] ?? [];
      const chefId  = chefIds.length > 0 ? chefIds[Math.floor(Math.random() * chefIds.length)] : null;
      try {
        const startRes = await fetch(`/api/steps/${id}/start`, {
          method: 'POST',
          ...(chefId ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chef_id: chefId }) } : {}),
        });
        console.log(`[sim] start  step ${id} → ${startRes.status}`);
        if (!startRes.ok && startRes.status !== 409) { scheduledRef.current.delete(id); return; }
      } catch (err) {
        console.warn(`[sim] start  step ${id} fetch error`, err);
        scheduledRef.current.delete(id);
        return;
      }

      const extraMs = Math.random() < delayChance ? (30 + Math.random() * 60) * 100 : 0;
      const cookMs  = estimatedDuration * 100 + extraMs;
      console.log(`[sim] scheduled completion for step ${id} in ${(cookMs / 1000).toFixed(1)}s`);

      setTimeout(async () => {
        if (!runningRef.current) { scheduledRef.current.delete(id); return; }
        console.log(`[sim] complete step ${id}`);
        try {
          const completeRes = await fetch(`/api/steps/${id}/complete`, { method: 'POST' });
          console.log(`[sim] complete step ${id} → ${completeRes.status}`);
        } catch (err) {
          console.warn(`[sim] complete step ${id} fetch error`, err);
        } finally {
          scheduledRef.current.delete(id);
        }
      }, cookMs);
    }, Math.random() * 3000);
  }, []);

  const pollFiredSteps = useCallback(async () => {
    if (!runningRef.current) return;

    const { data: allActive } = await supabase
      .from('order_steps')
      .select('id, step_number, estimated_duration, station_id, order_item_id, status, started_at, order_items!inner(order_id)')
      .in('status', ['pending', 'fired', 'in_progress'])
      .order('step_number', { ascending: true });

    const active = allActive ?? [];

    const busyDish    = new Set<string>();
    const busyStation = new Set<string>();

    let reAdopted = 0;
    for (const s of active) {
      if (s.status !== 'in_progress') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderId = (s.order_items as any)?.order_id;
      busyDish.add(s.order_item_id);
      if (orderId) busyStation.add(`${orderId}:${s.station_id}`);

      if (!scheduledRef.current.has(s.id)) {
        const startedAtMs = s.started_at ? new Date(s.started_at).getTime() : Date.now();
        const totalCookMs = s.estimated_duration * 100;
        const remainingMs = Math.max(0, totalCookMs - (Date.now() - startedAtMs));
        console.log(`[sim] re-adopting orphaned step ${s.id}, completing in ${(remainingMs / 1000).toFixed(1)}s`);
        scheduledRef.current.add(s.id);
        reAdopted++;
        setTimeout(async () => {
          if (!runningRef.current) { scheduledRef.current.delete(s.id); return; }
          try {
            const res = await fetch(`/api/steps/${s.id}/complete`, { method: 'POST' });
            console.log(`[sim] re-adopted complete step ${s.id} → ${res.status}`);
          } catch (err) {
            console.warn(`[sim] re-adopted complete step ${s.id} fetch error`, err);
          } finally {
            scheduledRef.current.delete(s.id);
          }
        }, remainingMs);
      }
    }

    const handledDish = new Set<string>();
    let newlyScheduled = 0;
    const skips = { busyDish: 0, handledDish: 0, noOrderId: 0, alreadyScheduled: 0, busyStation: 0 };

    for (const step of active) {
      if (step.status === 'in_progress') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderId = (step.order_items as any)?.order_id;

      if (busyDish.has(step.order_item_id))    { skips.busyDish++;    handledDish.add(step.order_item_id); continue; }
      if (handledDish.has(step.order_item_id)) { skips.handledDish++; continue; }
      handledDish.add(step.order_item_id);
      if (!orderId) { skips.noOrderId++; continue; }
      if (scheduledRef.current.has(step.id)) { skips.alreadyScheduled++; continue; }

      const stationKey = `${orderId}:${step.station_id}`;
      if (busyStation.has(stationKey)) { skips.busyStation++; continue; }

      busyStation.add(stationKey);
      scheduledRef.current.add(step.id);
      scheduleStep(step.id, step.estimated_duration, presetCfgRef.current.delayChance, step.station_id);
      newlyScheduled++;
    }

    const inProgressCount = active.filter(s => s.status === 'in_progress').length;
    console.log(
      `[sim] poll — active:${active.length} in_progress:${inProgressCount} sched_set:${scheduledRef.current.size} new:${newlyScheduled} re-adopted:${reAdopted}`,
      `| skips: busy_dish:${skips.busyDish} handled:${skips.handledDish} already_sched:${skips.alreadyScheduled} busy_station:${skips.busyStation}`,
    );
  }, [supabase, scheduleStep]);

  const createOrder = useCallback(async (items: CatalogItem[]) => {
    if (!runningRef.current) return;

    const { data: activeOrders } = await supabase
      .from('orders')
      .select('table_number')
      .in('status', ['pending', 'active']);

    if ((activeOrders?.length ?? 0) >= 6) return;

    const occupiedTables  = new Set((activeOrders ?? []).map(o => o.table_number));
    const availableTables = Array.from({ length: 20 }, (_, i) => i + 1).filter(n => !occupiedTables.has(n));
    if (availableTables.length === 0) return;

    const tableNumber = availableTables[Math.floor(Math.random() * availableTables.length)];
    const shuffled    = [...items].sort(() => Math.random() - 0.5);
    const picked      = shuffled.slice(0, 1 + Math.floor(Math.random() * 3));

    await fetch('/api/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ table_number: tableNumber, items: picked.map(m => m.id) }),
    }).catch(() => {});
  }, [supabase]);

  // Start the cook-poll interval. Safe to call when it's already running.
  function startCookPoll() {
    if (cookPollTimer.current) return;
    pollFiredSteps();
    cookPollTimer.current = setInterval(() => {
      console.log('sim: interval tick');
      pollFiredSteps();
    }, 2000);
  }

  function stopCookPoll() {
    if (cookPollTimer.current) clearInterval(cookPollTimer.current);
    cookPollTimer.current = null;
  }

  // Toggle Auto Mode: just the cook poll, no order generation.
  function handleAutoToggle() {
    if (autoMode) {
      runningRef.current = false;
      setAutoMode(false);
      setOrdersRunning(false);
      scheduledRef.current.clear();
      if (orderTimer.current) clearInterval(orderTimer.current);
      orderTimer.current = null;
      stopCookPoll();
    } else {
      runningRef.current = true;
      setAutoMode(true);
      startCookPoll();
    }
  }

  function launchKitchen(items: CatalogItem[]) {
    presetCfgRef.current = PRESETS[preset];
    runningRef.current   = true;
    setOrdersRunning(true);
    setAutoMode(true);

    const intervalMs = (60 / presetCfgRef.current.ordersPerMin) * 1000;
    createOrder(items);
    orderTimer.current = setInterval(() => createOrder(items), intervalMs);

    startCookPoll(); // no-op if already running via auto toggle
  }

  async function handleStart() {
    // Allow starting orders even when auto mode is already on.
    if (!catalog || catalog.length === 0 || ordersRunning) return;

    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'active']);

    if ((count ?? 0) > 0) {
      setExistingOrderCount(count!);
      return;
    }

    launchKitchen(catalog);
  }

  function handleConfirmContinue() {
    setExistingOrderCount(null);
    launchKitchen(catalog!);
  }

  async function handleConfirmReset() {
    setExistingOrderCount(null);
    await fetch('/api/reset', { method: 'POST' });
    launchKitchen(catalog!);
  }

  function handleStopOrders() {
    setOrdersRunning(false);
    if (orderTimer.current) clearInterval(orderTimer.current);
    orderTimer.current = null;
  }

  function handleStopKitchen() {
    runningRef.current = false;
    setOrdersRunning(false);
    setAutoMode(false);
    scheduledRef.current.clear();
    if (orderTimer.current) clearInterval(orderTimer.current);
    orderTimer.current = null;
    stopCookPoll();
  }

  useEffect(() => {
    return () => {
      if (orderTimer.current)    clearInterval(orderTimer.current);
      if (cookPollTimer.current) clearInterval(cookPollTimer.current);
    };
  }, []);

  return (
    <div className="border-b border-gray-800 bg-gray-950 shrink-0">

      {/* Toggle row — always visible */}
      <div className="w-full flex items-center justify-between px-6 py-2 text-xs">

        {/* Left: expand/collapse + status */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span className="tabular-nums">{open ? '▾' : '▸'}</span>
          <span className="font-semibold uppercase tracking-wider">Simulation</span>
          {autoMode && (
            <span className="text-blue-400 font-semibold animate-pulse">· AUTO</span>
          )}
          {autoMode && ordersRunning && (
            <span className={`font-semibold text-green-400`}>
              · Running — {PRESETS[preset].label}
            </span>
          )}
          {autoMode && !ordersRunning && (
            <span className="font-semibold text-amber-400">· Draining</span>
          )}
        </button>

        {/* Right: Auto toggle (always visible) */}
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {!autoMode && <span className="text-gray-700 italic">Idle</span>}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-gray-500 font-medium">Auto</span>
            <button
              role="switch"
              aria-checked={autoMode}
              onClick={handleAutoToggle}
              className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                ${autoMode ? 'bg-blue-600' : 'bg-gray-600'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                  ${autoMode ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </button>
          </label>
        </div>
      </div>

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
                  disabled={ordersRunning}
                  onClick={() => setPreset(key)}
                  className={[
                    'px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                    preset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white',
                    ordersRunning ? 'opacity-40 cursor-not-allowed' : '',
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

              <div className="flex gap-2 items-center flex-wrap">
                {/* Stop orders (only when generating) */}
                {ordersRunning && (
                  <button
                    onClick={handleStopOrders}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-amber-700 hover:bg-amber-600 text-white transition-colors"
                  >
                    ■ Stop Orders
                  </button>
                )}

                {/* Stop kitchen (clears cook poll + orders) */}
                {autoMode && (
                  <button
                    onClick={handleStopKitchen}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-red-700 hover:bg-red-600 text-white transition-colors"
                  >
                    ■ Stop Kitchen
                  </button>
                )}

                {/* Confirmation dialog */}
                {!ordersRunning && existingOrderCount !== null && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-amber-400 font-medium">
                      {existingOrderCount} active order{existingOrderCount !== 1 ? 's' : ''} from a previous session. Continue them or reset first?
                    </span>
                    <button
                      onClick={handleConfirmContinue}
                      className="px-4 py-1.5 rounded text-xs font-bold bg-green-700 hover:bg-green-600 text-white transition-colors"
                    >
                      Continue
                    </button>
                    <button
                      onClick={handleConfirmReset}
                      className="px-4 py-1.5 rounded text-xs font-bold bg-red-700 hover:bg-red-600 text-white transition-colors"
                    >
                      Reset Kitchen
                    </button>
                  </div>
                )}

                {/* Start simulation button — available even when auto mode is on */}
                {!ordersRunning && existingOrderCount === null && (
                  <button
                    onClick={handleStart}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-green-700 hover:bg-green-600 text-white transition-colors"
                  >
                    ▶ Start
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
