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

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function SimulationBar() {
  const [supabase]          = useState(() => createClient());
  const [open, setOpen]     = useState(false);
  const [preset, setPreset] = useState<PresetKey>('steady');
  const [ordersRunning, setOrdersRunning] = useState(false);
  const [autoMode,      setAutoMode]      = useState(false);
  const [catalog, setCatalog]             = useState<CatalogItem[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [existingOrderCount, setExistingOrderCount] = useState<number | null>(null);

  const runningRef    = useRef(false);
  const generationRef = useRef(0);        // incremented each time loops are (re)started
  const presetCfgRef  = useRef<typeof PRESETS[PresetKey]>(PRESETS.steady);
  const orderTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // One async loop per chef. Exits when runningRef is false or generation changes.
  const runChefLoop = useCallback(async (chef: SimChef, generation: number) => {
    const tag = `[chef:${chef.name}]`;
    console.log(`${tag} chef loop started (gen ${generation}, stations: [${chef.stationIds.join(', ')}])`);

    while (runningRef.current && generationRef.current === generation) {
      console.log(`${tag} looking for step…`);

      // 1. Re-adopt any in_progress step already assigned to me
      const { data: mine } = await supabase
        .from('order_steps')
        .select('id, estimated_duration, started_at')
        .eq('status', 'in_progress')
        .eq('assigned_chef_id', chef.id)
        .limit(1);

      if (!runningRef.current || generationRef.current !== generation) break;

      if (mine && mine.length > 0) {
        const s = mine[0];
        const elapsed    = s.started_at ? Date.now() - new Date(s.started_at).getTime() : 0;
        const remainingMs = Math.max(0, s.estimated_duration * 100 - elapsed);
        console.log(`${tag} re-adopting step ${s.id.slice(0, 6)}, completing in ${(remainingMs / 1000).toFixed(1)}s`);
        await sleep(remainingMs);
        if (!runningRef.current || generationRef.current !== generation) break;
        await fetch(`/api/steps/${s.id}/complete`, { method: 'POST' });
        continue;
      }

      // 2. Find a fired/pending step at my stations that's free or already mine
      const { data: candidates } = await supabase
        .from('order_steps')
        .select('id, estimated_duration')
        .in('status', ['fired', 'pending'])
        .in('station_id', chef.stationIds)
        .or(`assigned_chef_id.is.null,assigned_chef_id.eq.${chef.id}`)
        .order('step_number', { ascending: true })
        .limit(1);

      if (!runningRef.current || generationRef.current !== generation) break;

      if (!candidates || candidates.length === 0) {
        console.log(`${tag} no step available — sleeping 2s`);
        await sleep(2000);
        continue;
      }

      const step = candidates[0];
      console.log(`${tag} found step ${step.id.slice(0, 8)} — claiming`);

      // 3. Claim it — may race another chef at the same station
      let claimed = false;
      try {
        const res = await fetch(`/api/steps/${step.id}/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chef_id: chef.id }),
        });
        console.log(`${tag} start ${step.id.slice(0, 6)} → ${res.status}`);
        if (res.ok) {
          claimed = true;
        } else if (res.status !== 409) {
          await sleep(2000); // unexpected error — back off
          continue;
        }
        // 409: lost the race, loop immediately to find next step
      } catch (err) {
        console.warn(`${tag} start error`, err);
        await sleep(2000);
        continue;
      }

      if (!runningRef.current || generationRef.current !== generation) break;
      if (!claimed) continue;

      // 4. Cook
      const extra  = Math.random() < presetCfgRef.current.delayChance ? (30 + Math.random() * 60) * 100 : 0;
      const cookMs = step.estimated_duration * 100 + extra;
      console.log(`${tag} cooking ${step.id.slice(0, 6)} for ${(cookMs / 1000).toFixed(1)}s`);
      await sleep(cookMs);

      if (!runningRef.current || generationRef.current !== generation) break;

      // 5. Complete
      try {
        const res = await fetch(`/api/steps/${step.id}/complete`, { method: 'POST' });
        console.log(`${tag} complete ${step.id.slice(0, 6)} → ${res.status}`);
      } catch (err) {
        console.warn(`${tag} complete error`, err);
      }
    }

    console.log(`${tag} loop exited (gen ${generation})`);
  }, [supabase]);

  // Fetches all chef→station assignments and spawns one loop per chef.
  // Increments generationRef so any existing loops from a prior call self-terminate.
  const startChefLoops = useCallback(async () => {
    const generation = ++generationRef.current;
    console.log(`[sim] startChefLoops called (gen ${generation}, running=${runningRef.current})`);

    const { data: rows, error } = await supabase
      .from('chef_stations')
      .select('chef_id, station_id, chefs!inner(name)');

    console.log(`[sim] chef_stations fetch: ${rows?.length ?? 0} rows, error=${error?.message ?? 'none'}`);
    console.log('[sim] raw chef_stations rows:', JSON.stringify(rows));

    if (!runningRef.current || generationRef.current !== generation) {
      console.log(`[sim] startChefLoops aborted (running=${runningRef.current}, gen now=${generationRef.current})`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chefMap: Record<string, SimChef> = {};
    for (const cs of rows ?? []) {
      if (!chefMap[cs.chef_id]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chefMap[cs.chef_id] = { id: cs.chef_id, name: (cs as any).chefs?.name ?? cs.chef_id.slice(0, 6), stationIds: [] };
      }
      chefMap[cs.chef_id].stationIds.push(cs.station_id);
    }

    const chefs = Object.values(chefMap);
    console.log(`[sim] spawning ${chefs.length} chef loop(s):`, chefs.map(c => c.name));
    for (const chef of chefs) {
      runChefLoop(chef, generation); // fire and forget
    }
  }, [supabase, runChefLoop]);

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
      generationRef.current++;
      setAutoMode(false);
      setOrdersRunning(false);
      if (orderTimer.current) clearInterval(orderTimer.current);
      orderTimer.current = null;
    } else {
      runningRef.current = true;
      setAutoMode(true);
      startChefLoops();
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

    startChefLoops(); // increments generation, safe to call even if already running
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
    generationRef.current++;
    setOrdersRunning(false);
    setAutoMode(false);
    if (orderTimer.current) clearInterval(orderTimer.current);
    orderTimer.current = null;
  }

  useEffect(() => {
    return () => {
      runningRef.current = false;
      generationRef.current++;
      if (orderTimer.current) clearInterval(orderTimer.current);
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

                {/* Stop kitchen (stops chef loops + orders) */}
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
