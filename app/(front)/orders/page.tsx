import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { requireRole } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

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
    status === 'completed'  ? 'bg-green-500'  :
    status === 'in_progress'? 'bg-amber-400 animate-pulse' :
    status === 'fired'      ? 'bg-amber-600'  :
                              'bg-gray-700';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} title={status} />;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default async function MyOrdersPage() {
  await requireRole('customer', 'admin');
  const { userId } = await auth();

  const { data: rawOrders } = await adminClient
    .from('orders')
    .select(`
      id, table_number, status, target_serve_time, created_at,
      order_items (
        id,
        menu_items ( name ),
        order_steps ( id, step_number, name, status )
      )
    `)
    .eq('clerk_user_id', userId!)
    .order('created_at', { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: MyOrder[] = (rawOrders ?? []).map((row: any) => ({
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

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">

        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
            ← Home
          </Link>
          <h1 className="text-2xl font-black tracking-tight">My Orders</h1>
          <span className="text-sm text-gray-500">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
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
              const badgeCls = STATUS_BADGE[order.status] ?? STATUS_BADGE.pending;
              const totalSteps = order.items.reduce((n, i) => n + i.steps.length, 0);
              const doneSteps  = order.items.reduce(
                (n, i) => n + i.steps.filter(s => s.status === 'completed').length, 0,
              );

              return (
                <div key={order.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                  {/* Order header */}
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

                  {/* Overall progress bar */}
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

                  {/* Dishes */}
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
          Refresh the page to see the latest progress.
        </p>
      </div>
    </main>
  );
}
