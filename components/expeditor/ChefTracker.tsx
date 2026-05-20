'use client';

import type { ActiveOrder, ChefWithStations } from './types';

interface ChefStatus {
  chef: ChefWithStations;
  tableNumber: number | null;
  dishName: string | null;
  stepName: string | null;
}

function deriveChefStatuses(
  chefs: ChefWithStations[],
  activeOrders: ActiveOrder[],
): ChefStatus[] {
  return [...chefs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(chef => {
      let best: {
        tableNumber: number;
        dishName: string;
        stepName: string;
        started_at: string | null;
      } | null = null;

      for (const order of activeOrders) {
        for (const dish of order.dishes) {
          for (const step of dish.steps) {
            if (step.assigned_chef_id !== chef.id || step.status !== 'in_progress') continue;
            if (
              !best ||
              (step.started_at && (!best.started_at || step.started_at > best.started_at))
            ) {
              best = {
                tableNumber: order.table_number,
                dishName: dish.menu_item_name,
                stepName: step.name,
                started_at: step.started_at,
              };
            }
          }
        }
      }

      return {
        chef,
        tableNumber: best?.tableNumber ?? null,
        dishName: best?.dishName ?? null,
        stepName: best?.stepName ?? null,
      };
    });
}

interface Props {
  chefs: ChefWithStations[];
  activeOrders: ActiveOrder[];
}

export default function ChefTracker({ chefs, activeOrders }: Props) {
  const statuses = deriveChefStatuses(chefs, activeOrders);

  return (
    <div className="border-t border-gray-800 p-4 flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Chefs</h2>
      {statuses.length === 0 ? (
        <p className="text-xs text-gray-600">No chefs assigned.</p>
      ) : (
        statuses.map(({ chef, tableNumber, dishName, stepName }) => {
          const stationNames = chef.chef_stations
            .map(cs => cs.stations?.name)
            .filter(Boolean)
            .sort()
            .join(', ');
          const idle = tableNumber === null;

          return (
            <div key={chef.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white truncate mr-2">
                  {chef.name}
                </span>
                <span className={`text-xs font-medium shrink-0 ${idle ? 'text-gray-600' : 'text-green-400'}`}>
                  {idle ? 'Idle' : `T${tableNumber}`}
                </span>
              </div>
              {stationNames && (
                <p className="text-xs text-gray-500 mb-1 truncate">{stationNames}</p>
              )}
              {!idle && (
                <p className="text-xs text-gray-300 leading-tight">
                  Table {tableNumber} · {dishName} · {stepName}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
