'use client';

import { useEffect, useState } from 'react';
import type { StepWithContext } from './StationView';

interface Props {
  step: StepWithContext;
  onUpdate: () => void;
}

function formatDuration(totalSeconds: number): string {
  const abs = Math.abs(Math.round(totalSeconds));
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function apiPost(url: string): Promise<boolean> {
  const res = await fetch(url, { method: 'POST' });
  return res.ok;
}

export default function StepCard({ step, onUpdate }: Props) {
  const [now,  setNow]  = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fireAtMs          = step.fire_at    ? new Date(step.fire_at).getTime()    : null;
  const startedAtMs       = step.started_at ? new Date(step.started_at).getTime() : null;
  const secondsUntilFire  = fireAtMs    !== null ? (fireAtMs - now) / 1000          : null;
  const elapsedSeconds    = startedAtMs !== null ? (now - startedAtMs) / 1000       : null;

  const isPending    = step.status === 'pending';
  const isFired      = step.status === 'fired';
  const isInProgress = step.status === 'in_progress';

  const progressPct = (isInProgress && elapsedSeconds !== null)
    ? Math.min(100, Math.round((elapsedSeconds / step.estimated_duration) * 100))
    : 0;

  // Card appearance
  const cardCls = isFired
    ? 'border-amber-500 bg-amber-950'
    : isInProgress
    ? 'border-green-600 bg-green-950'
    : 'border-gray-700 bg-gray-900';

  async function handleStart() {
    setBusy(true);
    await apiPost(`/api/steps/${step.id}/start`);
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
    <div className={`rounded-xl border-2 p-4 transition-colors ${cardCls}`}>

      {/* Top row */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Table {step.table_number}
          </p>
          <p className="text-xl font-bold text-white mt-0.5">{step.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">Step {step.step_number}</p>
        </div>

        {/* Flag button — TODO: POST /api/steps/[id]/flag once route exists */}
        <button
          disabled={busy}
          title="Signal a delay"
          className="text-gray-600 hover:text-red-400 disabled:opacity-30 transition-colors p-1 text-lg leading-none"
          onClick={() => { /* TODO */ }}
        >
          ⚑
        </button>
      </div>

      {/* Timer / status */}
      <div className="mb-4 min-h-[2.5rem] flex items-center">
        {isPending && secondsUntilFire !== null && (
          <span className={`font-mono text-sm ${secondsUntilFire < 0 ? 'text-red-400' : 'text-gray-300'}`}>
            {secondsUntilFire >= 0
              ? `Start in ${formatDuration(secondsUntilFire)}`
              : `Overdue by ${formatDuration(secondsUntilFire)}`}
          </span>
        )}

        {isFired && (
          <span className="text-2xl font-black text-amber-400 animate-pulse tracking-wide">
            START NOW
          </span>
        )}

        {isInProgress && elapsedSeconds !== null && (
          <div className="w-full">
            <span className="font-mono text-sm text-green-300">
              Cooking… {formatDuration(elapsedSeconds)} / {formatDuration(step.estimated_duration)}
            </span>
            <div className="mt-2 h-2 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {(isFired || isInProgress) && (
        <div className="flex gap-2">
          {isFired && (
            <button
              onClick={handleStart}
              disabled={busy}
              className="flex-1 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                         text-black font-bold text-sm disabled:opacity-40 transition-colors"
            >
              {busy ? '…' : 'Start'}
            </button>
          )}
          <button
            onClick={handleComplete}
            disabled={busy}
            className="flex-1 py-3 rounded-lg bg-white hover:bg-gray-100 active:bg-gray-200
                       text-black font-bold text-sm disabled:opacity-40 transition-colors"
          >
            {busy ? '…' : 'Done'}
          </button>
        </div>
      )}
    </div>
  );
}
