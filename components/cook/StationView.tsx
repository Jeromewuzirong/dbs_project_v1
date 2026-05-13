'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import StepCard from './StepCard';

interface Station {
  id: string;
  name: string;
}

interface ChefOption {
  id: string;
  name: string;
}

export interface StepWithContext {
  id: string;
  step_number: number;
  name: string;
  estimated_duration: number;
  status: string;
  fire_at: string | null;
  ready_at: string | null;
  started_at: string | null;
  flagged_at: string | null;
  order_item_id: string;
  station_id: string;
  assigned_chef_id: string | null;
  order_id: string;
  table_number: number;
  order_delay_status: string;
}

interface Props {
  stations: Station[];
}

export default function StationView({ stations }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [supabase] = useState(() => createClient());

  const stationId       = searchParams.get('station') ?? stations[0]?.id ?? null;
  const chefId          = searchParams.get('chef') ?? null;
  const selectedStation = stations.find(s => s.id === stationId);

  const [steps,       setSteps]       = useState<StepWithContext[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [chefOptions, setChefOptions] = useState<ChefOption[]>([]);
  const [autoMode,    setAutoMode]    = useState(false);

  // Refs for use inside intervals/async IIFEs without stale closures
  const stepsRef         = useRef<StepWithContext[]>([]);
  const autoScheduledRef = useRef<Set<string>>(new Set());

  useEffect(() => { stepsRef.current = steps; }, [steps]);

  // Turn off auto mode whenever the chef or station changes
  useEffect(() => { setAutoMode(false); }, [chefId, stationId]);

  const fetchSteps = useCallback(async (sid: string) => {
    const { data, error } = await supabase
      .from('order_steps')
      .select(`
        id, step_number, name, estimated_duration, status,
        fire_at, ready_at, started_at, flagged_at,
        order_item_id, station_id, assigned_chef_id,
        order_items!inner (
          order_id,
          orders!inner (
            table_number,
            delay_status
          )
        )
      `)
      .eq('station_id', sid)
      .in('status', ['pending', 'fired', 'in_progress'])
      .order('fire_at', { ascending: true });

    if (error || !data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSteps(data.map((row: any) => ({
      id:                  row.id,
      step_number:         row.step_number,
      name:                row.name,
      estimated_duration:  row.estimated_duration,
      status:              row.status,
      fire_at:             row.fire_at,
      ready_at:            row.ready_at,
      started_at:          row.started_at,
      flagged_at:          row.flagged_at,
      order_item_id:       row.order_item_id,
      station_id:          row.station_id,
      assigned_chef_id:    row.assigned_chef_id,
      order_id:            row.order_items.order_id,
      table_number:        row.order_items.orders.table_number,
      order_delay_status:  row.order_items.orders.delay_status,
    })));
  }, [supabase]);

  // Fetch chef options whenever the selected station changes
  useEffect(() => {
    if (!stationId) { setChefOptions([]); return; }

    fetch('/api/chefs')
      .then(r => r.json())
      .then((data: { id: string; name: string; chef_stations: { station_id: string }[] }[]) => {
        const seen = new Map<string, ChefOption>();
        for (const c of data) {
          if (!seen.has(c.id) && c.chef_stations.some(cs => cs.station_id === stationId)) {
            seen.set(c.id, { id: c.id, name: c.name });
          }
        }
        const filtered = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
        setChefOptions(filtered);
      })
      .catch(() => {});
  }, [stationId]);

  // Subscribe to Realtime changes for the current station
  useEffect(() => {
    if (!stationId) return;

    setLoading(true);
    fetchSteps(stationId).finally(() => setLoading(false));

    const channel = supabase
      .channel(`cook-station-${stationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_steps', filter: `station_id=eq.${stationId}` },
        () => fetchSteps(stationId),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [stationId, supabase, fetchSteps]);

  // Auto mode: poll every 2s, pick up fired/in_progress steps for this chef
  useEffect(() => {
    if (!autoMode || !chefId || !stationId) return;

    const tick = () => {
      const eligible = stepsRef.current.filter(s => {
        if (autoScheduledRef.current.has(s.id)) return false;
        if (s.status !== 'fired' && s.status !== 'in_progress') return false;
        return s.assigned_chef_id === chefId || s.assigned_chef_id === null;
      });

      for (const step of eligible) {
        autoScheduledRef.current.add(step.id);
        const cookMs = step.estimated_duration * 100; // 10x speed

        (async () => {
          try {
            if (step.status !== 'in_progress') {
              const res = await fetch(`/api/steps/${step.id}/start`, { method: 'POST' });
              // 409 = already started by someone else — still continue to complete
              if (!res.ok && res.status !== 409) return;
            }
            await new Promise<void>(resolve => setTimeout(resolve, cookMs));
            await fetch(`/api/steps/${step.id}/complete`, { method: 'POST' });
          } catch {
            // swallow — Realtime will reconcile state
          } finally {
            autoScheduledRef.current.delete(step.id);
          }
        })();
      }
    };

    const intervalId = setInterval(tick, 2000);
    return () => {
      clearInterval(intervalId);
      autoScheduledRef.current.clear();
    };
  }, [autoMode, chefId, stationId]);

  function handleStationChange(e: React.ChangeEvent<HTMLSelectElement>) {
    // Clear chef when switching station — chef list will change
    router.push(`?station=${e.target.value}`);
  }

  function handleChefChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set('chef', e.target.value);
    } else {
      params.delete('chef');
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-col h-screen">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
            ← Back
          </Link>
          <h1 className="text-lg font-bold tracking-wide text-white">Kitchen Orchestrator</h1>
          {autoMode && (
            <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-black uppercase tracking-widest animate-pulse">
              AUTO
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">

          {/* Auto Mode toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-sm text-gray-400 font-medium">Auto</span>
            <button
              role="switch"
              aria-checked={autoMode}
              disabled={!chefId}
              onClick={() => setAutoMode(v => !v)}
              title={chefId ? 'Toggle auto mode' : 'Select a chef to enable auto mode'}
              className={`relative w-11 h-6 rounded-full transition-colors
                focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                ${autoMode ? 'bg-blue-600' : 'bg-gray-600'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${autoMode ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </label>

          {/* Chef selector */}
          <select
            value={chefId ?? ''}
            onChange={handleChefChange}
            className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Chef —</option>
            {chefOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Station selector */}
          <select
            value={stationId ?? ''}
            onChange={handleStationChange}
            className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {stations.length === 0 && <option value="">No stations</option>}
            {stations.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Station label */}
      <div className="px-6 py-5 bg-gray-900 border-b border-gray-800 shrink-0">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Now Serving</p>
        <span className="text-5xl font-black text-white tracking-tight">
          {selectedStation?.name ?? '—'}
        </span>
      </div>

      {/* Queue */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading && (
          <p className="text-center text-gray-500 py-12 text-sm">Loading…</p>
        )}
        {!loading && steps.length === 0 && (
          <p className="text-center text-gray-500 py-12 text-sm">Queue is clear.</p>
        )}
        {steps.map(step => (
          <StepCard
            key={step.id}
            step={step}
            onUpdate={() => stationId && fetchSteps(stationId)}
          />
        ))}
      </div>
    </div>
  );
}
