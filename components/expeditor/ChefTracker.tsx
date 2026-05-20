'use client';

import type { ChefTask, ChefWithStations } from './types';

interface Props {
  chefs: ChefWithStations[];
  chefTasks: Record<string, ChefTask>;
}

export default function ChefTracker({ chefs, chefTasks }: Props) {
  const sorted = [...chefs].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="border-t border-gray-800 p-4 flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Chefs</h2>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-600">No chefs assigned.</p>
      ) : (
        sorted.map(chef => {
          const task = chefTasks[chef.id] ?? null;
          const stationNames = chef.chef_stations
            .map(cs => cs.stations?.name)
            .filter(Boolean)
            .sort()
            .join(', ');

          return (
            <div key={chef.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white truncate mr-2">
                  {chef.name}
                </span>
                <span className={`text-xs font-medium shrink-0 ${task ? 'text-green-400' : 'text-gray-600'}`}>
                  {task ? `T${task.tableNumber}` : 'Idle'}
                </span>
              </div>
              {stationNames && (
                <p className="text-xs text-gray-500 mb-1 truncate">{stationNames}</p>
              )}
              {task ? (
                <p className="text-xs text-white leading-tight">
                  Table {task.tableNumber} · {task.dishName} · {task.stepName}
                </p>
              ) : (
                <p className="text-xs text-gray-600">Idle</p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
