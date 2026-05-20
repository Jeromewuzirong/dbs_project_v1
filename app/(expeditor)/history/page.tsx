import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { DelayStatus } from '@/lib/types';
import { requireRole } from '@/lib/auth';

const HISTORY_SELECT = `
  id, table_number, target_serve_time, created_at,
  order_items (
    id,
    order_steps ( completed_at )
  )
`;

const SOFT_DELAY_TOLERANCE_MS = 60 * 1000;

interface CompletedOrder {
  id: string;
  table_number: number;
  target_serve_time: string;
  delay_status: DelayStatus;
  created_at: string;
  dish_count: number;
  completed_at: string | null;
  total_seconds: number | null;
}

const DELAY_LABELS: Record<DelayStatus, { label: string; cls: string }> = {
  on_track:   { label: 'On track',   cls: 'text-green-400'  },
  soft_delay: { label: 'Soft delay', cls: 'text-amber-400'  },
  hard_delay: { label: 'Hard delay', cls: 'text-red-400'    },
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

export default async function HistoryPage() {
  await requireRole('chef', 'admin');
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
        {orders.length === 0 ? (
          <p className="text-center text-gray-500 py-24 text-sm">No completed orders yet.</p>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                <th className="pb-3 pr-8 font-semibold">Table</th>
                <th className="pb-3 pr-8 font-semibold">Dishes</th>
                <th className="pb-3 pr-8 font-semibold">Target serve</th>
                <th className="pb-3 pr-8 font-semibold">Completed at</th>
                <th className="pb-3 pr-8 font-semibold">Status</th>
                <th className="pb-3 font-semibold">Total time</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const delay = DELAY_LABELS[order.delay_status] ?? DELAY_LABELS.on_track;
                return (
                  <tr
                    key={order.id}
                    className="border-b border-gray-800/50 hover:bg-gray-900/40 transition-colors"
                  >
                    <td className="py-3 pr-8 font-bold text-white text-base">
                      {order.table_number}
                    </td>
                    <td className="py-3 pr-8 text-gray-300">
                      {order.dish_count}
                    </td>
                    <td className="py-3 pr-8 text-gray-400 font-mono text-xs tabular-nums">
                      {formatTimestamp(order.target_serve_time)}
                    </td>
                    <td className="py-3 pr-8 text-gray-300 font-mono text-xs tabular-nums">
                      {order.completed_at ? formatTimestamp(order.completed_at) : '—'}
                    </td>
                    <td className={`py-3 pr-8 font-semibold text-xs ${delay.cls}`}>
                      {delay.label}
                    </td>
                    <td className="py-3 text-gray-300 font-mono text-xs tabular-nums">
                      {order.total_seconds !== null ? formatDuration(order.total_seconds) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
