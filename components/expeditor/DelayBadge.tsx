import type { DelayStatus } from '@/lib/types';

const CLASSES: Record<DelayStatus, string> = {
  on_track:   'bg-green-900  text-green-300',
  soft_delay: 'bg-yellow-900 text-yellow-300',
  hard_delay: 'bg-red-900    text-red-300',
};

const LABELS: Record<DelayStatus, string> = {
  on_track:   'On Track',
  soft_delay: 'Soft Delay',
  hard_delay: 'HARD DELAY',
};

export default function DelayBadge({ status }: { status: DelayStatus }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
