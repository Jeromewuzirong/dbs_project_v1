'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Role = 'customer' | 'chef' | 'admin';
type Phase = 'loading' | 'selecting' | 'chef-picking' | 'ready';

interface RoleState {
  role: Role;
  customerId?: string; // customer: UUID for order tracking
  chefId?: string;
  chefName?: string;
}

interface ChefOption {
  id: string;
  name: string;
}

const STORAGE_KEY = 'kitchen_role';

function readStorage(): RoleState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RoleState) : null;
  } catch {
    return null;
  }
}

function writeStorage(state: RoleState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Selecting phase ───────────────────────────────────────────────────────────

function RoleSelector({
  onCustomer,
  onChef,
  onAdmin,
}: {
  onCustomer: () => void;
  onChef: () => void;
  onAdmin: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="text-center mb-14">
        <h1 className="text-5xl font-black tracking-tight text-white mb-3">
          Kitchen Orchestrator
        </h1>
        <p className="text-lg text-gray-400">
          Real-time kitchen flow management for restaurants
        </p>
      </div>

      <p className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-6">
        Who are you?
      </p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl">
        <button
          onClick={onCustomer}
          className="flex-1 flex flex-col items-center gap-2 rounded-2xl bg-green-700 hover:bg-green-600 active:bg-green-800
                     text-white font-bold text-base py-8 px-6 transition-colors shadow-lg shadow-green-900/40 cursor-pointer"
        >
          <span className="text-3xl">🧾</span>
          I&apos;m a Customer
          <span className="text-xs font-normal text-green-300 mt-1">Place & track orders</span>
        </button>

        <button
          onClick={onChef}
          className="flex-1 flex flex-col items-center gap-2 rounded-2xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700
                     text-black font-bold text-base py-8 px-6 transition-colors shadow-lg shadow-amber-900/40 cursor-pointer"
        >
          <span className="text-3xl">🍳</span>
          I&apos;m a Chef
          <span className="text-xs font-normal text-amber-900 mt-1">Manage your station queue</span>
        </button>

        <button
          onClick={onAdmin}
          className="flex-1 flex flex-col items-center gap-2 rounded-2xl bg-blue-700 hover:bg-blue-600 active:bg-blue-800
                     text-white font-bold text-base py-8 px-6 transition-colors shadow-lg shadow-blue-900/40 cursor-pointer"
        >
          <span className="text-3xl">📋</span>
          I&apos;m an Admin
          <span className="text-xs font-normal text-blue-300 mt-1">Full kitchen access</span>
        </button>
      </div>
    </div>
  );
}

// ── Chef name picker ──────────────────────────────────────────────────────────

function ChefPicker({
  onConfirm,
  onBack,
}: {
  onConfirm: (chef: ChefOption) => void;
  onBack: () => void;
}) {
  const [chefs, setChefs]           = useState<ChefOption[]>([]);
  const [selected, setSelected]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    fetch('/api/chefs')
      .then(r => r.json())
      .then((data: { id: string; name: string }[]) => {
        const list = Array.isArray(data) ? data.map(c => ({ id: c.id, name: c.name })) : [];
        setChefs(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  function handleConfirm() {
    const chef = chefs.find(c => c.id === selected);
    if (chef) onConfirm(chef);
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h2 className="text-2xl font-black text-white mb-2 text-center">Select your name</h2>
        <p className="text-gray-500 text-sm text-center mb-8">Choose the chef name assigned to you</p>

        {loading && (
          <p className="text-center text-gray-500 text-sm">Loading chefs…</p>
        )}

        {!loading && fetchError && (
          <p className="text-center text-red-400 text-sm">Failed to load chefs. Try again.</p>
        )}

        {!loading && !fetchError && chefs.length === 0 && (
          <p className="text-center text-gray-500 text-sm">
            No chefs in the system yet. Ask an admin to add you first.
          </p>
        )}

        {!loading && !fetchError && chefs.length > 0 && (
          <>
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-amber-500 mb-5"
            >
              {chefs.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <button
              onClick={handleConfirm}
              className="w-full py-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                         text-black font-black text-base transition-colors mb-3 cursor-pointer"
            >
              Continue →
            </button>
          </>
        )}

        <button
          onClick={onBack}
          className="w-full py-3 rounded-xl text-gray-500 hover:text-white text-sm font-medium transition-colors cursor-pointer"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

// ── Dashboard (ready state) ───────────────────────────────────────────────────

function Dashboard({
  roleState,
  onSwitch,
}: {
  roleState: RoleState;
  onSwitch: () => void;
}) {
  const { role, chefName } = roleState;
  const isCustomer = role === 'customer' || role === 'admin';
  const isStaff    = role === 'chef'     || role === 'admin';
  const isAdmin    = role === 'admin';

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-black tracking-tight text-white mb-3">
          Kitchen Orchestrator
        </h1>
        {chefName && (
          <p className="text-amber-400 font-semibold">
            Signed in as chef: {chefName}
          </p>
        )}
        {!chefName && (
          <p className="text-lg text-gray-400">
            Real-time kitchen flow management for restaurants
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl flex-wrap justify-center">
        {isCustomer && (
          <Link
            href="/order"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl bg-green-600 hover:bg-green-500 active:bg-green-700
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-green-900/40 cursor-pointer"
          >
            <span className="text-2xl">🧾</span>
            Place Order
          </Link>
        )}

        {isCustomer && (
          <Link
            href="/orders"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl bg-green-800 hover:bg-green-700 active:bg-green-900
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-green-900/30 cursor-pointer"
          >
            <span className="text-2xl">📦</span>
            My Orders
          </Link>
        )}

        {isStaff && (
          <Link
            href="/dashboard"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-blue-900/40 cursor-pointer"
          >
            <span className="text-2xl">📋</span>
            Expeditor Dashboard
          </Link>
        )}

        {isStaff && (
          <Link
            href="/station"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                       text-black font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-amber-900/40 cursor-pointer"
          >
            <span className="text-2xl">🍳</span>
            Cook Station
          </Link>
        )}

        {roleState.chefId && (
          <Link
            href="/tasks"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl bg-amber-700 hover:bg-amber-600 active:bg-amber-800
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-amber-900/30 cursor-pointer"
          >
            <span className="text-2xl">✓</span>
            My Tasks
          </Link>
        )}

        {isStaff && (
          <Link
            href="/history"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl border border-gray-700 hover:border-gray-500 hover:bg-gray-900
                       text-gray-400 hover:text-white font-bold text-lg py-6 px-6 transition-colors cursor-pointer"
          >
            <span className="text-2xl">📜</span>
            History
          </Link>
        )}

        {isStaff && (
          <Link
            href="/leaderboard"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 rounded-2xl border border-gray-700 hover:border-gray-500 hover:bg-gray-900
                       text-gray-400 hover:text-white font-bold text-lg py-6 px-6 transition-colors cursor-pointer"
          >
            <span className="text-2xl">🏆</span>
            Leaderboard
          </Link>
        )}
      </div>

      {isAdmin && (
        <div className="mt-10 flex items-center gap-6">
          <Link href="/chefs" className="text-sm text-gray-600 hover:text-gray-400 transition-colors cursor-pointer">
            Manage Chefs
          </Link>
          <ResetButton />
        </div>
      )}

      <button
        onClick={onSwitch}
        className="mt-12 text-xs text-gray-700 hover:text-gray-500 transition-colors underline underline-offset-2 cursor-pointer"
      >
        Switch Role
      </button>
    </div>
  );
}

function ResetButton() {
  const [busy, setBusy] = useState(false);
  async function handleReset() {
    if (!confirm('Are you sure? This will delete all active orders.')) return;
    setBusy(true);
    await fetch('/api/reset', { method: 'POST' });
    setBusy(false);
  }
  return (
    <button
      onClick={handleReset}
      disabled={busy}
      className="text-sm text-gray-600 hover:text-gray-400 disabled:opacity-40 transition-colors cursor-pointer"
    >
      {busy ? 'Resetting…' : 'Reset Kitchen'}
    </button>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [phase, setPhase]         = useState<Phase>('loading');
  const [roleState, setRoleState] = useState<RoleState | null>(null);

  useEffect(() => {
    const stored = readStorage();
    if (stored) {
      setRoleState(stored);
      setPhase('ready');
    } else {
      setPhase('selecting');
    }
  }, []);

  function handleCustomer() {
    const state: RoleState = { role: 'customer', customerId: crypto.randomUUID() };
    writeStorage(state);
    setRoleState(state);
    setPhase('ready');
  }

  function handleAdmin() {
    const state: RoleState = { role: 'admin' };
    writeStorage(state);
    setRoleState(state);
    setPhase('ready');
  }

  function handleChefConfirm(chef: ChefOption) {
    const state: RoleState = { role: 'chef', chefId: chef.id, chefName: chef.name };
    writeStorage(state);
    setRoleState(state);
    setPhase('ready');
  }

  function handleSwitch() {
    localStorage.removeItem(STORAGE_KEY);
    setRoleState(null);
    setPhase('selecting');
  }

  if (phase === 'loading') return <div className="min-h-screen bg-gray-950" />;

  if (phase === 'selecting') {
    return (
      <RoleSelector
        onCustomer={handleCustomer}
        onChef={() => setPhase('chef-picking')}
        onAdmin={handleAdmin}
      />
    );
  }

  if (phase === 'chef-picking') {
    return (
      <ChefPicker
        onConfirm={handleChefConfirm}
        onBack={() => setPhase('selecting')}
      />
    );
  }

  return <Dashboard roleState={roleState!} onSwitch={handleSwitch} />;
}
