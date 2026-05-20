import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { DelayStatus } from '@/lib/types';
import HistoryAccordion, { type CompletedOrder } from './HistoryAccordion';

const HISTORY_SELECT = `
  id, table_number, target_serve_time, created_at,
  order_items (
    id,
    order_steps ( completed_at )
  )
`;

const SOFT_DELAY_TOLERANCE_MS = 60 * 1000;

export default async function HistoryPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select(HISTORY_SELECT)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-6">
        <p className="text-red-400">Failed to load history: {error.message}</p>
      </main>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: CompletedOrder[] = (data ?? []).map((row: any) => {
    const allCompletedAts: string[] = (row.order_items ?? []).flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (oi: any) => (oi.order_steps ?? []).map((s: any) => s.completed_at).filter(Boolean),
    );

    const completedAt = allCompletedAts.length > 0
      ? allCompletedAts.reduce((max, t) => (t > max ? t : max))
      : null;

    const totalSeconds = completedAt
      ? Math.round((new Date(completedAt).getTime() - new Date(row.created_at).getTime()) / 1000)
      : null;

    let delay_status: DelayStatus = 'on_track';
    if (completedAt) {
      const overByMs = new Date(completedAt).getTime() - new Date(row.target_serve_time).getTime();
      if (overByMs > SOFT_DELAY_TOLERANCE_MS) delay_status = 'hard_delay';
      else if (overByMs > 0)                  delay_status = 'soft_delay';
    }

    return {
      id:                row.id,
      table_number:      row.table_number,
      target_serve_time: row.target_serve_time,
      delay_status,
      created_at:        row.created_at,
      dish_count:        (row.order_items ?? []).length,
      completed_at:      completedAt,
      total_seconds:     totalSeconds,
    };
  });

  // Sort by actual completion time descending (most recently completed first).
  orders.sort((a, b) => {
    if (!a.completed_at && !b.completed_at) return 0;
    if (!a.completed_at) return 1;
    if (!b.completed_at) return -1;
    return a.completed_at < b.completed_at ? 1 : -1;
  });

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center gap-4">
        <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
          ← Back
        </Link>
        <h1 className="text-lg font-bold tracking-wide">Order History</h1>
        <span className="text-sm text-gray-500">{orders.length} completed</span>
      </header>

      <div className="p-6 overflow-x-auto">
        <HistoryAccordion orders={orders} />
      </div>
    </main>
  );
}
