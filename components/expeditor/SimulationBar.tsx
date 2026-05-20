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

interface SimChef {
  id: string;
  name: string;
  stationIds: string[];
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

  const runningRef        = useRef(false);
  const dispatchTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const presetCfgRef      = useRef<typeof PRESETS[PresetKey]>(PRESETS.steady);
  const orderTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  // Dishes assigned this dispatcher session but whose cook timer hasn't fired yet.
  // Prevents next-step pickup before the current step finishes cooking.
  const assignedDishIds   = useRef<Set<string>>(new Set());

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

  // Central dispatcher: one tick every 2 s.
  // Reads current DB state, then serially assigns idle chefs to unclaimed steps.
  const dispatch = useCallback(async (chefs: SimChef[]) => {
    if (!runningRef.current) return;

    // 1. Which chefs and dishes are already occupied?
    const { data: inProgress } = await supabase
      .from('order_steps')
      .select('assigned_chef_id, order_item_id')
      .eq('status', 'in_progress');

    if (!runningRef.current) return;

    const busyChefIds = new Set<string>();
    const busyDishIds = new Set<string>();
    for (const row of inProgress ?? []) {
      if (row.assigned_chef_id) busyChefIds.add(row.assigned_chef_id);
      busyDishIds.add(row.order_item_id);
    }

    // 2. Actionable steps: fired/pending, not in a dish that already has a step in_progress.
    const { data: rawCandidates } = await supabase
      .from('order_steps')
      .select('id, station_id, order_item_id, estimated_duration, step_number')
      .in('status', ['fired', 'pending'])
      .order('step_number', { ascending: true });

    if (!runningRef.current) return;

    const candidates = (rawCandidates ?? []).filter(
      s => !busyDishIds.has(s.order_item_id) && !assignedDishIds.current.has(s.order_item_id)
    );

    // 3. Assign each candidate to a randomly chosen eligible idle chef.
    const assignedThisTick = new Set<string>();

    for (const step of candidates) {
      const eligible = chefs.filter(c =>
        c.stationIds.includes(step.station_id) &&
        !busyChefIds.has(c.id) &&
        !assignedThisTick.has(c.id)
      );
      if (eligible.length === 0) continue;

      const chef = eligible[Math.floor(Math.random() * eligible.length)];

      try {
        const res = await fetch(`/api/steps/${step.id}/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chef_id: chef.id }),
        });

        if (res.ok) {
          busyChefIds.add(chef.id);
          assignedThisTick.add(chef.id);
          assignedDishIds.current.add(step.order_item_id);

          const extra  = Math.random() < presetCfgRef.current.delayChance ? (30 + Math.random() * 60) * 100 : 0;
          const cookMs = step.estimated_duration * 100 + extra;
          setTimeout(() => {
            assignedDishIds.current.delete(step.order_item_id);
            if (!runningRef.current) return;
            fetch(`/api/steps/${step.id}/complete`, { method: 'POST' }).catch(() => {});
          }, cookMs);
        }
      } catch {
        // transient error — will retry next tick
      }
    }
  }, [supabase]);

  const stopDispatcher = useCallback(() => {
    if (dispatchTimerRef.current) {
      clearInterval(dispatchTimerRef.current);
      dispatchTimerRef.current = null;
    }
    assignedDishIds.current.clear();
  }, []);

  const startDispatcher = useCallback((chefs: SimChef[]) => {
    if (dispatchTimerRef.current) return; // guard: already running
    dispatch(chefs);
    dispatchTimerRef.current = setInterval(() => dispatch(chefs), 2000);
  }, [dispatch]);

  const fetchChefsAndStartDispatcher = useCallback(() => {
    type ApiChef = { id: string; name: string; chef_stations: { station_id: string }[] };
    fetch('/api/chefs')
      .then(r => r.json())
      .then((data: ApiChef[]) => {
        const chefs: SimChef[] = data
          .filter(c => c.chef_stations.length > 0)
          .map(c => ({ id: c.id, name: c.name, stationIds: c.chef_stations.map(cs => cs.station_id) }));
        startDispatcher(chefs);
      })
      .catch(() => {});
  }, [startDispatcher]);

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

  function handleAutoToggle() {
    if (autoMode) {
      runningRef.current = false;
      stopDispatcher();
      setAutoMode(false);
      setOrdersRunning(false);
      if (orderTimer.current) clearInterval(orderTimer.current);
      orderTimer.current = null;
    } else {
      runningRef.current = true;
      setAutoMode(true);
      fetchChefsAndStartDispatcher();
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

    if (!dispatchTimerRef.current) {
      fetchChefsAndStartDispatcher();
    }
  }

  async function handleStart() {
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
    stopDispatcher();
    setOrdersRunning(false);
    setAutoMode(false);
    if (orderTimer.current) clearInterval(orderTimer.current);
    orderTimer.current = null;
  }

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (dispatchTimerRef.current) clearInterval(dispatchTimerRef.current);
      if (orderTimer.current) clearInterval(orderTimer.current);
    };
  }, []); // refs are stable; runs only on unmount

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

                {/* Stop kitchen (stops dispatcher + orders) */}
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
