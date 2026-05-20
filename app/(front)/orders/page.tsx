'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type StepStatus = 'pending' | 'fired' | 'in_progress' | 'completed';

interface OrderStep {
  id: string;
  step_number: number;
  name: string;
  status: StepStatus;
}

interface OrderItem {
  id: string;
  dish_name: string;
  steps: OrderStep[];
}

interface ActiveOrder {
  id: string;
  table_number: number;
  status: string;
  target_serve_time: string;
  created_at: string;
  items: OrderItem[];
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-blue-900 text-blue-300 border-blue-700',
  pending:   'bg-gray-800 text-gray-400 border-gray-700',
  completed: 'bg-green-900 text-green-300 border-green-700',
};

function StepPip({ status }: { status: StepStatus }) {
  const cls =
    status === 'completed'   ? 'bg-green-500' :
    status === 'in_progress' ? 'bg-amber-400 animate-pulse' :
    status === 'fired'       ? 'bg-amber-600' :
                               'bg-gray-700';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} title={status} />;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrders(raw: any[]): ActiveOrder[] {
  return raw.map(row => ({
    id:                row.id,
    table_number:      row.table_number,
    status:            row.status,
    target_serve_time: row.target_serve_time,
    created_at:        row.created_at,
    items: (row.order_items ?? []).map((oi: any) => ({
      id:        oi.id,
      dish_name: oi.menu_items?.name ?? 'Unknown',
      steps:     (oi.order_steps ?? []).slice().sort((a: any, b: any) => a.step_number - b.step_number),
    })),
  }));
}

export default function MyOrdersPage() {
  const [supabase]   = useState(() => createClient());
  const [input, setInput]           = useState('');
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [orders, setOrders]         = useState<ActiveOrder[]>([]);
  const [loading, setLoading]       = useState(false);

  const fetchOrders = useCallback(async (table: number, silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select(`
        id, table_number, status, target_serve_time, created_at,
        order_items (
          id,
          menu_items ( name ),
          order_steps ( id, step_number, name, status )
        )
      `)
      .eq('table_number', table)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false });

    setOrders(mapOrders(data ?? []));
    setLoading(false);
  }, [supabase]);

  // Subscribe to changes whenever a table is being tracked.
  useEffect(() => {
    if (tableNumber === null) return;

    fetchOrders(tableNumber);

    const channel = supabase
      .channel(`table-orders-${tableNumber}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_steps' },
        () => fetchOrders(tableNumber, true),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `table_number=eq.${tableNumber}` },
        () => fetchOrders(tableNumber, true),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, tableNumber, fetchOrders]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(input, 10);
    if (n >= 1 && n <= 20) setTableNumber(n);
  }

  // ── Table picker ──────────────────────────────────────────────────────────
  if (tableNumber === null) {
    return (
      <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
        <Link href="/" className="absolute top-6 left-6 text-gray-600 hover:text-gray-400 text-sm transition-colors cursor-pointer">
          ← Home
        </Link>

        <h1 className="text-3xl font-black text-white mb-2">Track Your Order</h1>
        <p className="text-gray-500 text-sm mb-10">Enter your table number to see live progress</p>

        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="number"
            min={1}
            max={20}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Table #"
            autoFocus
            className="w-32 bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 text-xl font-bold
                       text-center focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-600"
          />
          <button
            type="submit"
            disabled={!input || parseInt(input, 10) < 1 || parseInt(input, 10) > 20}
            className="px-6 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40
                       text-white font-bold text-base transition-colors cursor-pointer"
          >
            Track →
          </button>
        </form>
      </main>
    );
  }

  // ── Orders view ───────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">

        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
            ← Home
          </Link>
          <h1 className="text-2xl font-black tracking-tight">Table {tableNumber}</h1>
          <button
            onClick={() => { setTableNumber(null); setInput(''); setOrders([]); }}
            className="ml-auto text-xs text-gray-500 hover:text-white transition-colors border border-gray-700 hover:border-gray-500 px-3 py-1 rounded-lg cursor-pointer"
          >
            Change table
          </button>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 text-sm py-16">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-500 mb-2">No active orders for Table {tableNumber}.</p>
            <p className="text-gray-700 text-sm">Updates automatically when your order is placed.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {orders.map(order => {
              const badgeCls   = STATUS_BADGE[order.status] ?? STATUS_BADGE.pending;
              const totalSteps = order.items.reduce((n, i) => n + i.steps.length, 0);
              const doneSteps  = order.items.reduce(
                (n, i) => n + i.steps.filter(s => s.status === 'completed').length, 0,
              );

              return (
                <div key={order.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeCls}`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Ordered {formatTime(order.created_at)}</p>
                      <p>Target ready {formatTime(order.target_serve_time)}</p>
                    </div>
                  </div>

                  {totalSteps > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progress</span>
                        <span>{doneSteps}/{totalSteps} steps</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-800">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all duration-500"
                          style={{ width: `${Math.round((doneSteps / totalSteps) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                    {order.items.map(item => (
                      <div key={item.id}>
                        <p className="text-sm font-semibold text-white mb-1.5">{item.dish_name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.steps.map(step => (
                            <div key={step.id} className="flex items-center gap-1">
                              <StepPip status={step.status} />
                              <span className="text-xs text-gray-500">{step.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-gray-700 mt-8">
          Updates automatically as your order is prepared.
        </p>
      </div>
    </main>
  );
}
