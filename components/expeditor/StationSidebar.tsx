import type { StationSummary } from './types';

export default function StationSidebar({ stations }: { stations: StationSummary[] }) {
  return (
    <aside className="w-60 shrink-0 border-l border-gray-800 flex flex-col p-4 gap-3 overflow-y-auto">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Stations</h2>
      {stations.map(s => (
        <div key={s.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
          <p className="text-sm font-semibold text-white mb-2">{s.name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {s.in_progress > 0 && (
              <span className="text-green-400">{s.in_progress} active</span>
            )}
            {s.fired > 0 && (
              <span className="text-amber-400">{s.fired} fired</span>
            )}
            {s.pending > 0 && (
              <span className="text-gray-400">{s.pending} pending</span>
            )}
            {s.in_progress === 0 && s.fired === 0 && s.pending === 0 && (
              <span className="text-gray-600">Idle</span>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
