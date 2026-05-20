'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  transformOrders,
  deriveStationSummaries,
  ORDER_SELECT,
} from './types';
import type { ActiveOrder, ChefTask, ChefWithStations, RawStation } from './types';
import OrderCard from './OrderCard';
import StationSidebar from './StationSidebar';
import ChefTracker from './ChefTracker';
import SimulationBar from './SimulationBar';

interface Props {
  initialOrders: ActiveOrder[];
  stations: RawStation[];
}

type DisplayOrder = ActiveOrder & { completing?: boolean };

const COMPLETION_ANIM_MS = 500;

export default function DashboardView({ initialOrders, stations }: Props) {
  const [supabase] = useState(() => createClient());
  const [displayOrders, setDisplayOrders] = useState<DisplayOrder[]>(initialOrders);
  const displayRef = useRef<DisplayOrder[]>(initialOrders);
  const [chefs, setChefs] = useState<ChefWithStations[]>([]);
  const [chefTasks, setChefTasks] = useState<Record<string, ChefTask>>({});
  const [unassignedTask, setUnassignedTask] = useState<ChefTask | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/chefs')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setChefs(data); })
      .catch(() => {});
  }, []);

  const fetchChefTasks = useCallback(async () => {
    const { data } = await supabase
      .from('order_steps')
      .select(`
        id, name, started_at, assigned_chef_id,
        order_items!inner (
          menu_items!inner ( name ),
          orders!inner ( table_number )
        )
      `)
      .eq('status', 'in_progress');

    if (!data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Row = { id: string; name: string; started_at: string | null; assigned_chef_id: string | null; order_items: any };

    const toTask = (row: Row): ChefTask => ({
      stepName:    row.name,
      dishName:    row.order_items?.menu_items?.name    ?? '',
      tableNumber: row.order_items?.orders?.table_number ?? 0,
    });

    const bestByChef: Record<string, Row> = {};
    let bestUnassigned: Row | null = null;

    for (const row of data as Row[]) {
      if (row.assigned_chef_id === null) {
        if (!bestUnassigned || (row.started_at && (!bestUnassigned.started_at || row.started_at > bestUnassigned.started_at))) {
          bestUnassigned = row;
        }
      } else {
        const prev = bestByChef[row.assigned_chef_id];
        if (!prev || (row.started_at && (!prev.started_at || row.started_at > prev.started_at))) {
          bestByChef[row.assigned_chef_id] = row;
        }
      }
    }

    const tasks: Record<string, ChefTask> = {};
    for (const [chefId, row] of Object.entries(bestByChef)) {
      tasks[chefId] = toTask(row);
    }
    setChefTasks(tasks);
    setUnassignedTask(bestUnassigned ? toTask(bestUnassigned) : null);
  }, [supabase]);

  useEffect(() => { fetchChefTasks(); }, [fetchChefTasks]);

  const refetch = useCallback(async () => {
    fetchChefTasks();
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .in('status', ['pending', 'active'])
      .order('target_serve_time', { ascending: true });

    if (error || !data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newOrders = transformOrders(data as any[]);
    const newIds    = new Set(newOrders.map(o => o.id));
    const newMap    = new Map(newOrders.map(o => [o.id, o]));

    // Merge: update existing, mark departing as completing, append new
    const next: DisplayOrder[] = displayRef.current.map(o =>
      newIds.has(o.id)
        ? { ...newMap.get(o.id)!, completing: false }
        : { ...o, completing: true }
    );
    const existingIds = new Set(displayRef.current.map(o => o.id));
    newOrders.filter(o => !existingIds.has(o.id)).forEach(o =>
      next.push({ ...o, completing: false })
    );

    const departingIds = next.filter(o => o.completing).map(o => o.id);

    displayRef.current = next;
    setDisplayOrders([...next]);

    if (departingIds.length > 0) {
      setTimeout(() => {
        const cleaned = displayRef.current.filter(o => !departingIds.includes(o.id));
        displayRef.current = cleaned;
        setDisplayOrders([...cleaned]);
      }, COMPLETION_ANIM_MS);
    }
  }, [supabase, fetchChefTasks]);

  useEffect(() => {
    const channel = supabase
      .channel('expeditor-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },      refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_steps' }, refetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, refetch]);

  // Background delay-status refresh: check every 30s for orders whose
  // target_serve_time has passed but still have incomplete steps.
  // Reads from displayRef to avoid stale-closure issues; Supabase Realtime
  // picks up any resulting DB write and triggers refetch automatically.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      displayRef.current
        .filter(o => !o.completing && new Date(o.target_serve_time) < now)
        .forEach(o => {
          fetch(`/api/orders/${o.id}/delay-status`, { method: 'PATCH' });
        });
    };

    const intervalId = setInterval(tick, 30_000);
    return () => clearInterval(intervalId);
  }, []); // intentionally no deps — reads live state via displayRef

  async function handleNewOrder() {
    const { data: menuItems } = await supabase.from('menu_items').select('id');
    if (!menuItems || menuItems.length === 0) return;

    const occupiedTables = new Set(displayRef.current.map(o => o.table_number));
    const available = Array.from({ length: 20 }, (_, i) => i + 1).filter(n => !occupiedTables.has(n));
    const tableNumber = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : Math.ceil(Math.random() * 20);

    const shuffled = [...menuItems].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 1 + Math.floor(Math.random() * 3)).map(m => m.id);

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_number: tableNumber, items: picked }),
    });

    if (!res.ok) return;

    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(`Order created: Table ${tableNumber}`);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }

  const activeOrders  = displayOrders.filter(o => !o.completing);
  const stationSummaries = deriveStationSummaries(stations, activeOrders);
  const activeCount  = activeOrders.filter(o => o.status === 'active').length;
  const pendingCount = activeOrders.filter(o => o.status === 'pending').length;

  return (
    <div className="flex h-screen">

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <SimulationBar />
        <header className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
              ← Back
            </Link>
            <Link href="/history" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
              History
            </Link>
            <Link href="/leaderboard" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
              Leaderboard
            </Link>
            <Link href="/chefs" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
              Manage Chefs
            </Link>
            <h1 className="text-lg font-bold tracking-wide text-white">Expeditor</h1>
          </div>
          <div className="flex items-center gap-4">
            {flash && (
              <span className="text-green-400 text-xs font-semibold animate-pulse">
                {flash}
              </span>
            )}
            <button
              onClick={handleNewOrder}
              className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 active:bg-green-800
                         text-white text-xs font-bold transition-colors cursor-pointer"
            >
              + New Order
            </button>
            <div className="flex gap-4 text-sm text-gray-400">
              <span><span className="text-white font-semibold">{activeCount}</span> active</span>
              <span><span className="text-white font-semibold">{pendingCount}</span> pending</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {displayOrders.length === 0 ? (
            <p className="text-center text-gray-500 py-24 text-sm">No active orders.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayOrders.map(order => (
                <OrderCard key={order.id} order={order} completing={order.completing} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: station sidebar + chef tracker */}
      <aside className="w-60 shrink-0 border-l border-gray-800 flex flex-col overflow-y-auto">
        <StationSidebar stations={stationSummaries} />
        <ChefTracker chefs={chefs} chefTasks={chefTasks} unassignedTask={unassignedTask} />
      </aside>
    </div>
  );
}
