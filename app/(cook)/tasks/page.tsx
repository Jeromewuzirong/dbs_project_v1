'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import StepCard from '@/components/cook/StepCard';
import type { StepWithContext } from '@/components/cook/StationView';

const STORAGE_KEY = 'kitchen_role';

export default function MyTasksPage() {
  const [supabase] = useState(() => createClient());

  const [chefId,   setChefId]   = useState<string | null>(null);
  const [chefName, setChefName] = useState<string>('');
  const [steps,    setSteps]    = useState<StepWithContext[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.chefId) {
          setChefId(parsed.chefId);
          setChefName(parsed.chefName ?? '');
        }
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  const fetchSteps = useCallback(async (cid: string) => {
    const { data, error } = await supabase
      .from('order_steps')
      .select(`
        id, step_number, name, estimated_duration, status,
        fire_at, ready_at, started_at, flagged_at,
        order_item_id, station_id, assigned_chef_id,
        order_items!inner (
          order_id,
          menu_items!inner ( name ),
          orders!inner (
            table_number,
            delay_status
          )
        )
      `)
      .eq('assigned_chef_id', cid)
      .in('status', ['pending', 'fired', 'in_progress'])
      .order('fire_at', { ascending: true });

    if (error || !data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSteps(data.map((row: any) => ({
      id:                 row.id,
      step_number:        row.step_number,
      name:               row.name,
      estimated_duration: row.estimated_duration,
      status:             row.status,
      fire_at:            row.fire_at,
      ready_at:           row.ready_at,
      started_at:         row.started_at,
      flagged_at:         row.flagged_at,
      order_item_id:      row.order_item_id,
      station_id:         row.station_id,
      assigned_chef_id:   row.assigned_chef_id,
      order_id:           row.order_items.order_id,
      table_number:       row.order_items.orders.table_number,
      order_delay_status: row.order_items.orders.delay_status,
      dish_name:          row.order_items.menu_items.name,
    })));
  }, [supabase]);

  useEffect(() => {
    if (!chefId) return;

    setLoading(true);
    fetchSteps(chefId).finally(() => setLoading(false));

    const channel = supabase
      .channel(`my-tasks-${chefId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_steps',
          filter: `assigned_chef_id=eq.${chefId}`,
        },
        () => fetchSteps(chefId),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [chefId, supabase, fetchSteps]);

  const refresh = useCallback(() => {
    if (chefId) fetchSteps(chefId);
  }, [chefId, fetchSteps]);

  if (!loading && !chefId) {
    return (
      <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-gray-400 text-lg font-semibold mb-2">Not signed in as a chef</p>
        <p className="text-gray-600 text-sm mb-8">Go back and select the Chef role first.</p>
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          ← Home
        </Link>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
            ← Back
          </Link>
          <h1 className="text-lg font-bold tracking-wide text-white">My Tasks</h1>
        </div>
        {chefName && (
          <span className="text-sm text-amber-400 font-semibold">{chefName}</span>
        )}
      </header>

      <div className="px-6 py-5 bg-gray-900 border-b border-gray-800 shrink-0">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Assigned to you</p>
        <span className="text-5xl font-black text-white tracking-tight">
          {steps.length} {steps.length === 1 ? 'Step' : 'Steps'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <p className="text-center text-gray-500 py-12 text-sm">Loading…</p>
        )}

        {!loading && steps.length === 0 && (
          <p className="text-center text-gray-500 py-12 text-sm">No tasks assigned to you right now.</p>
        )}

        {!loading && steps.length > 0 && (
          <div className="space-y-4">
            {steps.map(step => (
              <StepCard
                key={step.id}
                step={step}
                chefId={chefId}
                dishName={step.dish_name}
                onUpdate={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
