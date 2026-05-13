'use client';

import { useState } from 'react';

interface Station {
  id: string;
  name: string;
  display_order: number;
}

interface Chef {
  id: string;
  name: string;
  station_id: string;
  stations: { name: string; display_order: number } | null;
}

interface Props {
  stations: Station[];
  initialChefs: Chef[];
}

export default function ChefManager({ stations, initialChefs }: Props) {
  const [chefs, setChefs]       = useState<Chef[]>(initialChefs);
  const [name, setName]         = useState('');
  const [stationId, setStationId] = useState(stations[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError]       = useState('');

  const sortedStations = [...stations].sort((a, b) => a.display_order - b.display_order);

  const grouped = sortedStations.map(station => ({
    station,
    chefs: chefs
      .filter(c => c.station_id === station.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !stationId) return;

    setSubmitting(true);
    setError('');

    const res = await fetch('/api/chefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), station_id: stationId }),
    });

    if (res.ok) {
      const chef: Chef = await res.json();
      setChefs(prev => [...prev, chef]);
      setName('');
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Error ${res.status}`);
    }
    setSubmitting(false);
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    const res = await fetch(`/api/chefs/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      setChefs(prev => prev.filter(c => c.id !== id));
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Error ${res.status}`);
    }
    setRemovingId(null);
  }

  return (
    <div className="space-y-8">
      {/* Chef list grouped by station */}
      <section className="space-y-4">
        {grouped.map(({ station, chefs: stationChefs }) => (
          <div key={station.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-gray-800/60 border-b border-gray-700">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {station.name}
              </span>
            </div>
            {stationChefs.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-600 italic">No chefs yet</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {stationChefs.map(chef => (
                  <li key={chef.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-white font-medium">{chef.name}</span>
                    <button
                      onClick={() => handleRemove(chef.id)}
                      disabled={removingId === chef.id}
                      className="text-xs text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors font-medium"
                    >
                      {removingId === chef.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      {/* Add Chef form */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Add a Chef
        </h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-600"
          />
          <select
            value={stationId}
            onChange={e => setStationId(e.target.value)}
            className="bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {sortedStations.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40
                       text-white font-bold px-6 py-2 transition-colors whitespace-nowrap"
          >
            {submitting ? 'Adding…' : 'Add Chef'}
          </button>
        </form>
        {error && (
          <p className="mt-3 text-sm text-red-400 font-medium">{error}</p>
        )}
      </section>
    </div>
  );
}
