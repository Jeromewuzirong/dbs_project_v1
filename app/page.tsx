import Link from 'next/link';

export default function Home() {
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

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <Link
          href="/dashboard"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                     text-white font-bold text-lg py-6 px-8 transition-colors shadow-lg shadow-blue-900/40"
        >
          <span className="text-2xl">📋</span>
          Expeditor Dashboard
        </Link>

        <Link
          href="/station"
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                     text-black font-bold text-lg py-6 px-8 transition-colors shadow-lg shadow-amber-900/40"
        >
          <span className="text-2xl">🍳</span>
          Cook Station
        </Link>
      </div>
    </div>
  );
}
