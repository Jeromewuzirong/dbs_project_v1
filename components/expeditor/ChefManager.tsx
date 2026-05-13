'use client';

import { useState } from 'react';

interface Station {
  id: string;
  name: string;
  display_order: number;
}

export interface Chef {
  id: string;
  name: string;
  created_at: string;
  chef_stations: {
    station_id: string;
    stations: { id: string; name: string; display_order: number } | null;
  }[];
}

interface Props {
  stations: Station[];
  initialChefs: Chef[];
}

function chefStationNames(chef: Chef, stations: Station[]): string[] {
  const order = Object.fromEntries(stations.map(s => [s.id, s.display_order]));
  return chef.chef_stations
    .map(cs => cs.stations)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0))
    .map(s => s.name);
}

export default function ChefManager({ stations, initialChefs }: Props) {
  const [chefs, setChefs]             = useState<Chef[]>(initialChefs);
  const [name, setName]               = useState('');
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting]   = useState(false);
  const [removingId, setRemovingId]   = useState<string | null>(null);
  const [error, setError]             = useState('');

  const sortedStations = [...stations].sort((a, b) => a.display_order - b.display_order);

  function toggleStation(id: string) {
    setSelectedStations(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selectedStations.size === 0) return;

    setSubmitting(true);
    setError('');

    const res = await fetch('/api/chefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), stations: [...selectedStations] }),
    });

    if (res.ok) {
      const chef: Chef = await res.json();
      setChefs(prev => [...prev, chef].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setSelectedStations(new Set());
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

      {/* Chef list */}
      <section>
        {chefs.length === 0 ? (
          <p className="text-gray-600 text-sm italic">No chefs yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
            {chefs.map(chef => {
              const stationNames = chefStationNames(chef, stations);
              return (
                <li key={chef.id} className="flex items-center justify-between px-4 py-3 bg-gray-900">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-white font-medium shrink-0">{chef.name}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {stationNames.map(n => (
                        <span
                          key={n}
                          className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded font-medium"
                        >
                          {n}
                        </span>
                      ))}
                      {stationNames.length === 0 && (
                        <span className="text-xs text-gray-600 italic">no stations</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(chef.id)}
                    disabled={removingId === chef.id}
                    className="ml-4 text-xs text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors font-medium shrink-0"
                  >
                    {removingId === chef.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Add Chef form */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Add a Chef
        </h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-600"
          />

          <fieldset>
            <legend className="text-xs text-gray-500 font-medium mb-2">Stations</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {sortedStations.map(s => (
                <label key={s.id} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedStations.has(s.id)}
                    onChange={() => toggleStation(s.id)}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm text-gray-300">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={submitting || !name.trim() || selectedStations.size === 0}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40
                       text-white font-bold px-6 py-2 transition-colors"
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
