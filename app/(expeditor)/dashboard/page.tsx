import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { transformOrders, ORDER_SELECT } from '@/components/expeditor/types';
import DashboardView from '@/components/expeditor/DashboardView';
import type { RawStation } from '@/components/expeditor/types';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [ordersResult, stationsResult] = await Promise.all([
    supabase
      .from('orders')
      .select(ORDER_SELECT)
      .in('status', ['pending', 'active'])
      .order('target_serve_time', { ascending: true }),
    supabase
      .from('stations')
      .select('id, name, display_order')
      .order('display_order'),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialOrders = transformOrders((ordersResult.data ?? []) as any[]);
  const stations: RawStation[] = stationsResult.data ?? [];

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}>
        <DashboardView initialOrders={initialOrders} stations={stations} />
      </Suspense>
    </main>
  );
}
