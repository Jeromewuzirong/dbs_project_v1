'use client';

import { useEffect, useState } from 'react';
import type { StepWithContext } from './StationView';

interface Props {
  step: StepWithContext;
  chefId: string | null;
  readonly?: boolean;
  onUpdate: () => void;
}

function formatDuration(totalSeconds: number): string {
  const abs = Math.abs(Math.round(totalSeconds));
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function apiPost(url: string, body?: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  return res.ok;
}

export default function StepCard({ step, chefId, readonly = false, onUpdate }: Props) {
  const [now,  setNow]  = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fireAtMs         = step.fire_at    ? new Date(step.fire_at).getTime()    : null;
  const startedAtMs      = step.started_at ? new Date(step.started_at).getTime() : null;
  const secondsUntilFire = (fireAtMs    !== null && now !== null) ? (fireAtMs - now) / 1000    : null;
  const elapsedSeconds   = (startedAtMs !== null && now !== null) ? (now - startedAtMs) / 1000 : null;

  const isPending    = step.status === 'pending';
  const isFired      = step.status === 'fired';
  const isInProgress = step.status === 'in_progress';

  const progressPct = (isInProgress && elapsedSeconds !== null)
    ? Math.min(100, Math.round((elapsedSeconds / step.estimated_duration) * 100))
    : 0;

  const cardCls = isFired
    ? 'border-amber-400 bg-amber-950 shadow-xl shadow-amber-900/60'
    : isInProgress
    ? 'border-green-500 bg-green-950 shadow-lg shadow-green-900/40'
    : 'border-gray-700 bg-gray-900';

  async function handleStart() {
    setBusy(true);
    await apiPost(`/api/steps/${step.id}/start`, chefId ? { chef_id: chefId } : undefined);
    onUpdate();
    setBusy(false);
  }

  async function handleComplete() {
    setBusy(true);
    await apiPost(`/api/steps/${step.id}/complete`);
    onUpdate();
    setBusy(false);
  }

  return (
    <div className={`relative rounded-2xl border-2 p-6 transition-all ${cardCls}`}>

      {/* Pulsing urgency ring for fired state */}
      {isFired && (
        <div className="absolute inset-0 rounded-2xl border-2 border-amber-400 animate-ping opacity-20 pointer-events-none" />
      )}

      {/* Top row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">
            Table {step.table_number}
          </p>
          <p className="text-2xl font-black text-white leading-tight">{step.name}</p>
          <p className="text-sm text-gray-500 mt-1 font-medium">
            Step {step.step_number} &middot; {Math.round(step.estimated_duration / 60)} min
          </p>
        </div>

        <button
          disabled={busy}
          title="Signal a delay"
          className="text-gray-700 hover:text-red-400 disabled:opacity-30 transition-colors p-1.5 text-xl leading-none"
          onClick={() => { /* TODO */ }}
        >
          ⚑
        </button>
      </div>

      {/* Timer / status */}
      <div className="mb-5 min-h-[3.5rem] flex items-center">
        {isPending && secondsUntilFire !== null && (
          <div className="flex flex-col gap-0.5">
            <span className={`font-mono text-base font-semibold ${secondsUntilFire < 0 ? 'text-red-400' : 'text-gray-300'}`}>
              {secondsUntilFire >= 0
                ? `Start in ${formatDuration(secondsUntilFire)}`
                : `Overdue by ${formatDuration(secondsUntilFire)}`}
            </span>
            <span className="text-xs text-gray-600 uppercase tracking-wider">Waiting</span>
          </div>
        )}

        {isFired && (
          <div className="flex flex-col gap-1">
            <span className="text-4xl font-black text-amber-300 animate-pulse tracking-wide leading-none">
              START NOW
            </span>
            <span className="text-xs text-amber-600 font-semibold uppercase tracking-wider">
              Time to fire this step
            </span>
          </div>
        )}

        {isInProgress && elapsedSeconds !== null && (
          <div className="w-full">
            <div className="flex justify-between items-baseline mb-2">
              <span className="font-mono text-base font-semibold text-green-300">
                {formatDuration(elapsedSeconds)}
              </span>
              <span className="font-mono text-sm text-gray-500">
                / {formatDuration(step.estimated_duration)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-gray-700/60 overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1.5 font-medium uppercase tracking-wider">Cooking…</p>
          </div>
        )}
      </div>

      {/* Action buttons — hidden in read-only (All Chefs) mode */}
      {!readonly && (isFired || isInProgress) && (
        <div className="flex gap-3">
          {isFired && (
            <button
              onClick={handleStart}
              disabled={busy}
              className="flex-1 py-4 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500
                         text-black font-black text-base disabled:opacity-40 transition-colors tracking-wide"
            >
              {busy ? '…' : 'START'}
            </button>
          )}
          <button
            onClick={handleComplete}
            disabled={busy}
            className="flex-1 py-4 rounded-xl bg-white hover:bg-gray-100 active:bg-gray-200
                       text-black font-bold text-base disabled:opacity-40 transition-colors"
          >
            {busy ? '…' : 'Done'}
          </button>
        </div>
      )}
    </div>
  );
}
