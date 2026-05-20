'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  transformOrders,
  deriveStationSummaries,
  ORDER_SELECT,
} from './types';
import type { ActiveOrder, ChefWithStations, RawStation } from './types';
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

  useEffect(() => {
    fetch('/api/chefs')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setChefs(data); })
      .catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
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
  }, [supabase]);

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
            <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
              ← Back
            </Link>
            <Link href="/history" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
              History
            </Link>
            <Link href="/chefs" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
              Manage Chefs
            </Link>
            <h1 className="text-lg font-bold tracking-wide text-white">Expeditor</h1>
          </div>
          <div className="flex gap-4 text-sm text-gray-400">
            <span><span className="text-white font-semibold">{activeCount}</span> active</span>
            <span><span className="text-white font-semibold">{pendingCount}</span> pending</span>
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
      <aside className="w-60 shrink-0 border-l border-gray-800 flex flex-col overflow-hidden">
        <StationSidebar stations={stationSummaries} />
        <ChefTracker chefs={chefs} activeOrders={activeOrders} />
      </aside>
    </div>
  );
}
