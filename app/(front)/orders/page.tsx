'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

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

interface MyOrder {
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
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrders(raw: any[]): MyOrder[] {
  return raw.map(row => ({
    id:                row.id,
    table_number:      row.table_number,
    status:            row.status,
    target_serve_time: row.target_serve_time,
    created_at:        row.created_at,
    items: (row.order_items ?? []).map((oi: any) => ({
      id:        oi.id,
      dish_name: oi.menu_items?.name ?? 'Unknown',
      steps: (oi.order_steps ?? [])
        .slice()
        .sort((a: any, b: any) => a.step_number - b.step_number),
    })),
  }));
}

export default function MyOrdersPage() {
  const [orders, setOrders]   = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [noId, setNoId]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async (customerId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
    try {
      const res  = await fetch(`/api/orders/mine?customerId=${customerId}`);
      const data = await res.json();
      setOrders(Array.isArray(data) ? mapOrders(data) : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('kitchen_role');
    const parsed = stored ? (JSON.parse(stored) as { customerId?: string }) : {};
    if (!parsed.customerId) {
      setLoading(false);
      setNoId(true);
      return;
    }
    fetchOrders(parsed.customerId);
  }, [fetchOrders]);

  function handleRefresh() {
    const stored = localStorage.getItem('kitchen_role');
    const parsed = stored ? (JSON.parse(stored) as { customerId?: string }) : {};
    if (parsed.customerId) fetchOrders(parsed.customerId);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading orders…</p>
      </main>
    );
  }

  if (noId) {
    return (
      <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-gray-400">No customer session found.</p>
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          ← Go to Home to set your role
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">

        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
            ← Home
          </Link>
          <h1 className="text-2xl font-black tracking-tight">My Orders</h1>
          <span className="text-sm text-gray-500">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="ml-auto text-xs text-gray-500 hover:text-white disabled:opacity-40 transition-colors border border-gray-700 hover:border-gray-500 px-3 py-1 rounded-lg"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-500 mb-4">No orders yet.</p>
            <Link
              href="/order"
              className="inline-block px-6 py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white font-bold transition-colors"
            >
              Place an order
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {orders.map(order => {
              const badgeCls  = STATUS_BADGE[order.status] ?? STATUS_BADGE.pending;
              const totalSteps = order.items.reduce((n, i) => n + i.steps.length, 0);
              const doneSteps  = order.items.reduce(
                (n, i) => n + i.steps.filter(s => s.status === 'completed').length, 0,
              );

              return (
                <div key={order.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-white">Table {order.table_number}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeCls}`}>
                        {order.status}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Ordered {formatTime(order.created_at)}</p>
                      <p>Target {formatTime(order.target_serve_time)}</p>
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
                          className="h-full rounded-full bg-green-500 transition-all"
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
          Hit Refresh to see the latest progress.
        </p>
      </div>
    </main>
  );
}
