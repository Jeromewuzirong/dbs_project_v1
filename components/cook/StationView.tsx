'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface ChefGroup {
  chefId: string | null;
  chefName: string;
  steps: StepWithContext[];
}

function buildGroups(steps: StepWithContext[], chefOptions: ChefOption[]): ChefGroup[] {
  const chefMap = new Map(chefOptions.map(c => [c.id, c.name]));
  const byChef = new Map<string | null, StepWithContext[]>();

  for (const step of steps) {
    const key = step.assigned_chef_id;
    if (!byChef.has(key)) byChef.set(key, []);
    byChef.get(key)!.push(step);
  }

  return [...byChef.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (chefMap.get(a) ?? a).localeCompare(chefMap.get(b) ?? b);
    })
    .map(([chefId, groupSteps]) => ({
      chefId,
      chefName: chefId ? (chefMap.get(chefId) ?? 'Unknown Chef') : 'Unassigned',
      steps: groupSteps,
    }));
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
        setChefOptions([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
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

  function handleStationChange(e: React.ChangeEvent<HTMLSelectElement>) {
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

  function handleAllChefs() {
    router.push(`?station=${stationId}`);
  }

  // In individual chef mode, show only steps assigned to that chef.
  const visibleSteps = chefId
    ? steps.filter(s => s.assigned_chef_id === chefId)
    : steps;

  const groups = !chefId ? buildGroups(steps, chefOptions) : [];

  return (
    <div className="flex flex-col h-screen">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
            ← Back
          </Link>
          <h1 className="text-lg font-bold tracking-wide text-white">Kitchen Orchestrator</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* View mode: All Chefs | Individual chef */}
          <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden text-sm">
            <button
              onClick={handleAllChefs}
              className={`px-3 py-2 font-semibold transition-colors ${
                !chefId
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              All Chefs
            </button>
            <div className="w-px bg-gray-700 self-stretch" />
            <select
              value={chefId ?? ''}
              onChange={handleChefChange}
              className={`px-3 py-2 focus:outline-none transition-colors cursor-pointer ${
                chefId
                  ? 'bg-gray-700 text-white font-semibold'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              <option value="">Chef…</option>
              {chefOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

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
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <p className="text-center text-gray-500 py-12 text-sm">Loading…</p>
        )}

        {/* All Chefs mode: grouped, read-only */}
        {!chefId && !loading && (
          <>
            {steps.length === 0 && (
              <p className="text-center text-gray-500 py-12 text-sm">Queue is clear.</p>
            )}
            {groups.map(group => (
              <section key={group.chefId ?? '__unassigned__'} className="mb-8">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-3">
                  <span className={group.chefId ? 'text-gray-400' : 'text-gray-600 italic'}>
                    {group.chefName}
                  </span>
                  <span className="text-gray-700 font-normal normal-case tracking-normal">
                    · {group.steps.length} step{group.steps.length !== 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.steps.map(step => (
                    <StepCard
                      key={step.id}
                      step={step}
                      chefId={null}
                      readonly
                      onUpdate={() => stationId && fetchSteps(stationId)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {/* Individual chef mode: filtered, interactive */}
        {chefId && !loading && (
          <div className="space-y-4">
            {visibleSteps.length === 0 && (
              <p className="text-center text-gray-500 py-12 text-sm">Queue is clear.</p>
            )}
            {visibleSteps.map(step => (
              <StepCard
                key={step.id}
                step={step}
                chefId={chefId}
                onUpdate={() => stationId && fetchSteps(stationId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
