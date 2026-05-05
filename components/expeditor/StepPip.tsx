import type { StepPipData } from './types';

const STATUS_CLASSES: Record<string, string> = {
  pending:     'bg-gray-600',
  fired:       'bg-amber-400',
  in_progress: 'bg-green-500 animate-pulse',
  completed:   'bg-white',
  delayed:     'bg-red-500',
};

export default function StepPip({ step }: { step: StepPipData }) {
  const cls = STATUS_CLASSES[step.status] ?? 'bg-gray-600';
  return (
    <div
      title={`${step.name} · ${step.station_name}`}
      className={`w-3 h-3 rounded-full shrink-0 cursor-default ${cls}`}
    />
  );
}
