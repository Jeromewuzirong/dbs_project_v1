'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useUser, SignInButton, UserButton } from '@clerk/nextjs';
import { useSearchParams, useRouter } from 'next/navigation';

type Role = 'customer' | 'chef' | 'admin';

function AccessDeniedBanner() {
  const params  = useSearchParams();
  const router  = useRouter();
  if (params.get('error') !== 'access_denied') return null;
  return (
    <div className="mb-8 flex items-center justify-between gap-4 rounded-xl border border-red-800 bg-red-950 px-5 py-3 text-sm text-red-300">
      <span>You don&apos;t have permission to access that page.</span>
      <button
        onClick={() => router.replace('/')}
        className="text-red-500 hover:text-red-300 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

function NavLinks({ role }: { role: Role }) {
  const isCustomer = role === 'customer' || role === 'admin';
  const isStaff    = role === 'chef'     || role === 'admin';
  const isAdmin    = role === 'admin';

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
        {isCustomer && (
          <Link
            href="/order"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-green-600 hover:bg-green-500 active:bg-green-700
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-green-900/40"
          >
            <span className="text-2xl">🧾</span>
            Place Order
          </Link>
        )}

        {isCustomer && (
          <Link
            href="/orders"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-green-800 hover:bg-green-700 active:bg-green-900
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-green-900/40"
          >
            <span className="text-2xl">📦</span>
            My Orders
          </Link>
        )}

        {isStaff && (
          <Link
            href="/dashboard"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                       text-white font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-blue-900/40"
          >
            <span className="text-2xl">📋</span>
            Expeditor Dashboard
          </Link>
        )}

        {isStaff && (
          <Link
            href="/station"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                       text-black font-bold text-lg py-6 px-6 transition-colors shadow-lg shadow-amber-900/40"
          >
            <span className="text-2xl">🍳</span>
            Cook Station
          </Link>
        )}

        {isStaff && (
          <Link
            href="/history"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-gray-700 hover:border-gray-500 hover:bg-gray-900
                       text-gray-400 hover:text-white font-bold text-lg py-6 px-6 transition-colors"
          >
            <span className="text-2xl">📜</span>
            History
          </Link>
        )}
      </div>

      {isAdmin && (
        <div className="mt-10 flex items-center gap-6">
          <Link
            href="/chefs"
            className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
          >
            Manage Chefs
          </Link>
          <ResetButton />
        </div>
      )}
    </>
  );
}

function ResetButton() {
  async function handleReset() {
    if (!confirm('Are you sure? This will delete all active orders.')) return;
    await fetch('/api/reset', { method: 'POST' });
  }
  return (
    <button
      onClick={handleReset}
      className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
    >
      Reset Kitchen
    </button>
  );
}

export default function Home() {
  const { user, isSignedIn, isLoaded } = useUser();
  const role = (user?.publicMetadata?.role as Role) ?? 'customer';

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      {/* Sign in / user button — top right */}
      <div className="absolute top-4 right-6">
        {isLoaded && (
          isSignedIn
            ? <UserButton />
            : (
              <SignInButton mode="modal">
                <button className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-4 py-2 transition-colors">
                  Sign in
                </button>
              </SignInButton>
            )
        )}
      </div>

      <div className="text-center mb-12">
        <h1 className="text-5xl font-black tracking-tight text-white mb-3">
          Kitchen Orchestrator
        </h1>
        <p className="text-lg text-gray-400">
          Real-time kitchen flow management for restaurants
        </p>
      </div>

      <Suspense fallback={null}>
        <AccessDeniedBanner />
      </Suspense>

      {!isLoaded && (
        <div className="w-full max-w-2xl h-32 rounded-2xl bg-gray-900 animate-pulse" />
      )}

      {isLoaded && !isSignedIn && (
        <div className="text-center">
          <p className="text-gray-500 mb-6">Sign in to access the kitchen.</p>
          <SignInButton mode="modal">
            <button className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-base transition-colors">
              Sign in
            </button>
          </SignInButton>
        </div>
      )}

      {isLoaded && isSignedIn && <NavLinks role={role} />}
    </div>
  );
}
