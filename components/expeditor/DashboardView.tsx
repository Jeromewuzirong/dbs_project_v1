'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  transformOrders,
  deriveStationSummaries,
  ORDER_SELECT,
} from './types';
import type { ActiveOrder, RawStation } from './types';
import OrderCard from './OrderCard';
import StationSidebar from './StationSidebar';
import SimulationBar from './SimulationBar';

interface Props {
  initialOrders: ActiveOrder[];
  stations: RawStation[];
}

export default function DashboardView({ initialOrders, stations }: Props) {
  const [supabase] = useState(() => createClient());
  const [orders, setOrders] = useState<ActiveOrder[]>(initialOrders);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .in('status', ['pending', 'active'])
      .order('target_serve_time', { ascending: true });

    if (error || !data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setOrders(transformOrders(data as any[]));
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel('expeditor-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },      refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_steps' }, refetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, refetch]);

  const stationSummaries = deriveStationSummaries(stations, orders);
  const activeCount  = orders.filter(o => o.status === 'active').length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;

  return (
    <div className="flex h-screen">

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <SimulationBar />
        <header className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-wide text-white">Expeditor</h1>
          <div className="flex gap-4 text-sm text-gray-400">
            <span><span className="text-white font-semibold">{activeCount}</span> active</span>
            <span><span className="text-white font-semibold">{pendingCount}</span> pending</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {orders.length === 0 ? (
            <p className="text-center text-gray-500 py-24 text-sm">No active orders.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {orders.map(order => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Station sidebar */}
      <StationSidebar stations={stationSummaries} />
    </div>
  );
}
