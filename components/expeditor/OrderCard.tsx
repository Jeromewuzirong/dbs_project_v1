'use client';

import { useEffect, useState } from 'react';
import type { ActiveOrder } from './types';
import DelayBadge from './DelayBadge';
import OrderItemRow from './OrderItemRow';

function formatCountdown(ms: number): string {
  const abs = Math.abs(Math.round(ms / 1000));
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function OrderCard({ order, completing = false }: { order: ActiveOrder; completing?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = new Date(order.target_serve_time).getTime() - now;
  const isLate      = remainingMs < 0;

  return (
    <div
      className={`bg-gray-900 border border-gray-700 rounded-xl flex flex-col h-64 overflow-hidden
                  transition-all duration-500 origin-top
                  ${completing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
    >

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Table</p>
          <p className="text-2xl font-black text-white leading-none">{order.table_number}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className={`font-mono text-lg font-bold tabular-nums ${isLate ? 'text-red-400' : 'text-gray-200'}`}>
            {isLate ? `+${formatCountdown(remainingMs)} overdue` : formatCountdown(remainingMs)}
          </p>
          <DelayBadge status={order.delay_status} />
        </div>
      </div>

      {/* Dish list */}
      <div className="flex-1 overflow-y-auto px-4 py-1">
        {order.dishes.map(dish => (
          <OrderItemRow key={dish.id} dish={dish} />
        ))}
      </div>
    </div>
  );
}
