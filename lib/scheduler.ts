import type { StepStatus } from './types';

// Scheduler-layer types use Date objects.
// The API route layer is responsible for converting Supabase ISO strings → Date
// before calling reschedule(), and Date → ISO string when writing back.

export interface StepInput {
  id: string;
  step_number: number;
  estimated_duration: number; // seconds
  status: StepStatus;
  fire_at: Date | null;
  ready_at: Date | null;
}

export interface OrderItemWithSteps {
  order_item_id: string;
  target_serve_time: Date;
  steps: StepInput[];
}

export interface ScheduledStep {
  id: string;
  fire_at: Date;
  ready_at: Date;
}

/**
 * Backward-schedules all steps for each order item so every dish converges
 * at target_serve_time.
 *
 * Steps with status 'in_progress' or 'completed' are frozen — their existing
 * fire_at/ready_at are preserved, and their fire_at becomes the anchor for
 * any preceding steps that are still pending.
 */
export function reschedule(orderItems: OrderItemWithSteps[]): ScheduledStep[] {
  const result: ScheduledStep[] = [];

  for (const { target_serve_time, steps } of orderItems) {
    const sorted = [...steps].sort((a, b) => a.step_number - b.step_number);
    let anchorMs = target_serve_time.getTime();

    for (let i = sorted.length - 1; i >= 0; i--) {
      const step = sorted[i];
      const frozen = step.status === 'in_progress' || step.status === 'completed';

      if (frozen) {
        const fireAtMs =
          step.fire_at?.getTime() ?? anchorMs - step.estimated_duration * 1000;
        const readyAtMs =
          step.ready_at?.getTime() ?? fireAtMs + step.estimated_duration * 1000;

        result.push({ id: step.id, fire_at: new Date(fireAtMs), ready_at: new Date(readyAtMs) });
        anchorMs = fireAtMs;
      } else {
        const readyAtMs = anchorMs;
        const fireAtMs = anchorMs - step.estimated_duration * 1000;

        result.push({ id: step.id, fire_at: new Date(fireAtMs), ready_at: new Date(readyAtMs) });
        anchorMs = fireAtMs;
      }
    }
  }

  return result;
}
