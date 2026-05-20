import type { DelayStatus, OrderStatus, StepStatus } from '@/lib/types';

export interface StepPipData {
  id: string;
  step_number: number;
  name: string;
  status: StepStatus;
  station_id: string;
  station_name: string;
  assigned_chef_id: string | null;
  started_at: string | null;
}

export interface ChefWithStations {
  id: string;
  name: string;
  chef_stations: {
    station_id: string;
    stations: { id: string; name: string; display_order: number } | null;
  }[];
}

export interface DishRow {
  id: string;
  menu_item_name: string;
  steps: StepPipData[];
}

export interface ActiveOrder {
  id: string;
  table_number: number;
  target_serve_time: string;
  delay_status: DelayStatus;
  status: OrderStatus;
  dishes: DishRow[];
}

export interface RawStation {
  id: string;
  name: string;
  display_order: number;
}

export interface StationSummary extends RawStation {
  fired: number;
  in_progress: number;
  pending: number;
}

export const ORDER_SELECT = `
  id, table_number, target_serve_time, delay_status, status,
  order_items (
    id,
    menu_items!inner ( name ),
    order_steps (
      id, step_number, name, status, station_id, assigned_chef_id, started_at,
      stations!inner ( name )
    )
  )
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformOrders(data: any[]): ActiveOrder[] {
  return data.map(row => ({
    id:                  row.id,
    table_number:        row.table_number,
    target_serve_time:   row.target_serve_time,
    delay_status:        row.delay_status,
    status:              row.status,
    dishes: (row.order_items ?? []).map((oi: any) => ({
      id:               oi.id,
      menu_item_name:   oi.menu_items?.name ?? '',
      steps: (oi.order_steps ?? [])
        .slice()
        .sort((a: any, b: any) => a.step_number - b.step_number)
        .map((s: any) => ({
          id:               s.id,
          step_number:      s.step_number,
          name:             s.name,
          status:           s.status,
          station_id:       s.station_id,
          station_name:     s.stations?.name ?? '',
          assigned_chef_id: s.assigned_chef_id ?? null,
          started_at:       s.started_at ?? null,
        })),
    })),
  }));
}

export function deriveStationSummaries(
  stations: RawStation[],
  orders: ActiveOrder[],
): StationSummary[] {
  const counts: Record<string, { fired: number; in_progress: number; pending: number }> = {};

  for (const s of stations) {
    counts[s.id] = { fired: 0, in_progress: 0, pending: 0 };
  }

  for (const order of orders) {
    for (const dish of order.dishes) {
      for (const step of dish.steps) {
        if (!counts[step.station_id]) continue;
        if      (step.status === 'fired')       counts[step.station_id].fired++;
        else if (step.status === 'in_progress') counts[step.station_id].in_progress++;
        else if (step.status === 'pending')     counts[step.station_id].pending++;
      }
    }
  }

  return stations.map(s => ({ ...s, ...counts[s.id] }));
}
