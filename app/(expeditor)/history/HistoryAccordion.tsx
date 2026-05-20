'use client';

import { useRef, useState, useCallback } from 'react';
import type { DelayStatus, StepStatus } from '@/lib/types';

export interface CompletedOrder {
  id: string;
  table_number: number;
  target_serve_time: string;
  delay_status: DelayStatus;
  created_at: string;
  dish_count: number;
  completed_at: string | null;
  total_seconds: number | null;
}

interface StepDetail {
  id: string;
  step_number: number;
  name: string;
  station_name: string | null;
  chef_name: string | null;
  estimated_duration: number;
  actual_duration: number | null;
  status: StepStatus;
}

interface DishDetail {
  id: string;
  dish_name: string;
  steps: StepDetail[];
}

const DELAY_LABELS: Record<DelayStatus, { label: string; cls: string }> = {
  on_track:   { label: 'On track',   cls: 'text-green-400' },
  soft_delay: { label: 'Soft delay', cls: 'text-amber-400' },
  hard_delay: { label: 'Hard delay', cls: 'text-red-400'   },
};

const STATUS_LABELS: Record<StepStatus, { label: string; cls: string }> = {
  pending:     { label: 'Pending',     cls: 'text-gray-500'   },
  fired:       { label: 'Fired',       cls: 'text-blue-400'   },
  in_progress: { label: 'In progress', cls: 'text-yellow-400' },
  completed:   { label: 'Completed',   cls: 'text-green-400'  },
  delayed:     { label: 'Delayed',     cls: 'text-red-400'    },
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

export default function HistoryAccordion({ orders }: { orders: CompletedOrder[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DishDetail[]>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const toggle = useCallback(async (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    if (id in details || inFlight.current.has(id)) return;

    inFlight.current.add(id);
    setLoadingIds(prev => new Set(prev).add(id));

    try {
      const res = await fetch(`/api/orders/${id}/steps`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DishDetail[] = await res.json();
      setDetails(prev => ({ ...prev, [id]: data }));
    } catch (e) {
      setFetchErrors(prev => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'Failed to load',
      }));
    } finally {
      inFlight.current.delete(id);
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [details]);

  if (orders.length === 0) {
    return (
      <p className="text-center text-gray-500 py-24 text-sm">No completed orders yet.</p>
    );
  }

  return (
    <table className="w-full text-sm text-left border-collapse">
      <thead>
        <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
          <th className="pb-3 pr-8 font-semibold">Table</th>
          <th className="pb-3 pr-8 font-semibold">Dishes</th>
          <th className="pb-3 pr-8 font-semibold">Target serve</th>
          <th className="pb-3 pr-8 font-semibold">Completed at</th>
          <th className="pb-3 pr-8 font-semibold">Status</th>
          <th className="pb-3 font-semibold">Total time</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(order => {
          const delay = DELAY_LABELS[order.delay_status] ?? DELAY_LABELS.on_track;
          const isExpanded = expanded.has(order.id);
          const isLoading = loadingIds.has(order.id);
          const dishDetails = details[order.id];
          const fetchError = fetchErrors[order.id];

          return (
            <OrderRow
              key={order.id}
              order={order}
              delay={delay}
              isExpanded={isExpanded}
              isLoading={isLoading}
              dishDetails={dishDetails}
              fetchError={fetchError}
              onToggle={toggle}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function OrderRow({
  order,
  delay,
  isExpanded,
  isLoading,
  dishDetails,
  fetchError,
  onToggle,
}: {
  order: CompletedOrder;
  delay: { label: string; cls: string };
  isExpanded: boolean;
  isLoading: boolean;
  dishDetails: DishDetail[] | undefined;
  fetchError: string | undefined;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      <tr
        onClick={() => onToggle(order.id)}
        className="border-b border-gray-800/50 hover:bg-gray-900/40 transition-colors cursor-pointer select-none"
      >
        <td className="py-3 pr-8 font-bold text-white text-base">
          <span className="inline-flex items-center gap-2">
            <span
              className="text-gray-500 text-[10px] transition-transform duration-150 inline-block"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            >
              ▶
            </span>
            {order.table_number}
          </span>
        </td>
        <td className="py-3 pr-8 text-gray-300">{order.dish_count}</td>
        <td className="py-3 pr-8 text-gray-400 font-mono text-xs tabular-nums">
          {formatTimestamp(order.target_serve_time)}
        </td>
        <td className="py-3 pr-8 text-gray-300 font-mono text-xs tabular-nums">
          {order.completed_at ? formatTimestamp(order.completed_at) : '—'}
        </td>
        <td className={`py-3 pr-8 font-semibold text-xs ${delay.cls}`}>
          {delay.label}
        </td>
        <td className="py-3 text-gray-300 font-mono text-xs tabular-nums">
          {order.total_seconds !== null ? formatDuration(order.total_seconds) : '—'}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-gray-700/50">
          <td colSpan={6} className="bg-gray-900/50 px-8 py-5">
            {isLoading && (
              <p className="text-gray-500 text-xs italic animate-pulse">Loading steps…</p>
            )}
            {fetchError && (
              <p className="text-red-400 text-xs">Error: {fetchError}</p>
            )}
            {dishDetails && dishDetails.length === 0 && (
              <p className="text-gray-500 text-xs">No steps found.</p>
            )}
            {dishDetails && dishDetails.map(dish => (
              <DishPanel key={dish.id} dish={dish} />
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function DishPanel({ dish }: { dish: DishDetail }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-semibold text-white mb-3">{dish.dish_name}</h3>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-700">
            <th className="pb-2 pr-6 font-semibold text-left">Step</th>
            <th className="pb-2 pr-6 font-semibold text-left">Station</th>
            <th className="pb-2 pr-6 font-semibold text-left">Chef</th>
            <th className="pb-2 pr-6 font-semibold text-right">Estimated</th>
            <th className="pb-2 pr-6 font-semibold text-right">Actual</th>
            <th className="pb-2 font-semibold text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {dish.steps.map(step => {
            const isOver =
              step.actual_duration !== null &&
              step.actual_duration > step.estimated_duration;
            const statusInfo = STATUS_LABELS[step.status] ?? STATUS_LABELS.pending;

            return (
              <tr
                key={step.id}
                className={`border-b border-gray-800/30 ${isOver ? 'bg-red-950/40' : ''}`}
              >
                <td className={`py-2 pr-6 ${isOver ? 'text-red-400' : 'text-gray-300'}`}>
                  {step.name}
                </td>
                <td className={`py-2 pr-6 ${isOver ? 'text-red-400/80' : 'text-gray-400'}`}>
                  {step.station_name ?? '—'}
                </td>
                <td className={`py-2 pr-6 font-medium ${isOver ? 'text-red-400' : 'text-gray-300'}`}>
                  {step.chef_name ?? '—'}
                </td>
                <td className={`py-2 pr-6 font-mono tabular-nums text-right ${isOver ? 'text-red-400/80' : 'text-gray-500'}`}>
                  {formatDuration(step.estimated_duration)}
                </td>
                <td className={`py-2 pr-6 font-mono tabular-nums text-right ${isOver ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>
                  {step.actual_duration !== null ? formatDuration(step.actual_duration) : '—'}
                </td>
                <td className={`py-2 font-semibold ${statusInfo.cls}`}>
                  {statusInfo.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
