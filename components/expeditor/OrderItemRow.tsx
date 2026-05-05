import type { DishRow } from './types';
import StepPip from './StepPip';

export default function OrderItemRow({ dish }: { dish: DishRow }) {
  const activeStep =
    dish.steps.find(s => s.status === 'in_progress' || s.status === 'fired') ??
    dish.steps.find(s => s.status === 'pending');

  return (
    <div className="py-2 border-b border-gray-800 last:border-0">
      <p className="text-sm font-semibold text-white leading-tight">{dish.menu_item_name}</p>
      {activeStep && (
        <p className="text-xs text-gray-400 mt-0.5 truncate">{activeStep.name}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {dish.steps.map(step => (
          <StepPip key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
