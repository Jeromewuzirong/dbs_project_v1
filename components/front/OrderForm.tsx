'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { MenuItem } from '@/lib/types';

interface Props {
  menuItems: MenuItem[];
}

function defaultServeTime(): string {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  // datetime-local format: YYYY-MM-DDTHH:MM
  return d.toISOString().slice(0, 16);
}

export default function OrderForm({ menuItems }: Props) {
  const [tableNumber, setTableNumber] = useState(1);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [targetServeTime, setTargetServeTime] = useState(defaultServeTime);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function adjust(id: string, delta: number) {
    setQuantities(prev => {
      const next = (prev[id] ?? 0) + delta;
      if (next <= 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }

  function reset() {
    setTableNumber(1);
    setQuantities({});
    setTargetServeTime(defaultServeTime());
    setStatus('idle');
    setErrorMsg('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const items: string[] = Object.entries(quantities).flatMap(([id, qty]) =>
      Array(qty).fill(id),
    );

    if (items.length === 0) {
      setErrorMsg('Select at least one item.');
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_number: tableNumber,
          target_serve_time: new Date(targetServeTime).toISOString(),
          items,
        }),
      });

      if (res.status === 201) {
        setStatus('success');
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? `Server error ${res.status}`);
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error — check your connection.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-white mb-2">Order placed!</h2>
        <p className="text-gray-400 mb-8">Table {tableNumber} is in the queue.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold py-3 px-6 transition-colors"
          >
            Place another order
          </button>
          <Link
            href="/dashboard"
            className="rounded-xl border border-gray-700 hover:border-gray-500 hover:bg-gray-900 text-gray-400 hover:text-white font-bold py-3 px-6 transition-colors text-center"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Table number */}
      <section>
        <label className="block text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Table number
        </label>
        <input
          type="number"
          min={1}
          max={20}
          value={tableNumber}
          onChange={e => setTableNumber(Number(e.target.value))}
          className="w-28 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 text-lg font-bold
                     focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </section>

      {/* Menu items */}
      <section>
        <label className="block text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Menu items
        </label>
        <ul className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
          {menuItems.map(item => {
            const qty = quantities[item.id] ?? 0;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-850 transition-colors"
              >
                <span className={`font-medium ${qty > 0 ? 'text-white' : 'text-gray-400'}`}>
                  {item.name}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => adjust(item.id, -1)}
                    disabled={qty === 0}
                    className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed
                               text-white font-bold transition-colors flex items-center justify-center"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-white font-bold tabular-nums">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjust(item.id, 1)}
                    className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-white font-bold transition-colors
                               flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Target serve time */}
      <section>
        <label className="block text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Target serve time
        </label>
        <input
          type="datetime-local"
          value={targetServeTime}
          onChange={e => setTargetServeTime(e.target.value)}
          className="bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2
                     focus:outline-none focus:ring-2 focus:ring-green-500
                     [color-scheme:dark]"
        />
      </section>

      {/* Error */}
      {status === 'error' && errorMsg && (
        <p className="text-red-400 text-sm font-medium">{errorMsg}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-40
                   text-white font-bold text-lg py-4 transition-colors"
      >
        {status === 'submitting' ? 'Placing order…' : 'Place Order'}
      </button>
    </form>
  );
}
