'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Home() {
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (!confirm('Are you sure? This will delete all active orders.')) return;
    setResetting(true);
    await fetch('/api/reset', { method: 'POST' });
    setResetting(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-black tracking-tight text-white mb-3">
          Kitchen Orchestrator
        </h1>
        <p className="text-lg text-gray-400">
          Real-time kitchen flow management for restaurants
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
        <Link
          href="/dashboard"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                     text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-blue-900/40"
        >
          <span className="text-2xl">📋</span>
          Expeditor Dashboard
        </Link>

        <Link
          href="/station"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                     text-black font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-amber-900/40"
        >
          <span className="text-2xl">🍳</span>
          Cook Station
        </Link>

        <Link
          href="/order"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-green-600 hover:bg-green-500 active:bg-green-700
                     text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-green-900/40"
        >
          <span className="text-2xl">🧾</span>
          Place Order
        </Link>

        <Link
          href="/history"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-gray-700 hover:border-gray-500 hover:bg-gray-900
                     text-gray-400 hover:text-white font-bold text-lg py-6 px-6 transition-colors"
        >
          <span className="text-2xl">📜</span>
          History
        </Link>
      </div>

      <button
        onClick={handleReset}
        disabled={resetting}
        className="mt-10 text-sm text-gray-600 hover:text-gray-400 disabled:opacity-40 transition-colors"
      >
        {resetting ? 'Resetting…' : 'Reset Kitchen'}
      </button>
    </div>
  );
}
