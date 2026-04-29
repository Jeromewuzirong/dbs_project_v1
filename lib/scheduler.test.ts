import { describe, it, expect } from 'vitest';
import { reschedule } from './scheduler';
import type { OrderItemWithSteps, StepInput } from './scheduler';

// T = new Date(0) (Unix epoch). All offsets below are seconds from T.
const T = (seconds: number) => new Date(seconds * 1000);

// Ribeye recipe from the proposal, all steps pending.
const ribeyeStepsPending = (): StepInput[] => [
  { id: 'sear',  step_number: 1, estimated_duration: 180, status: 'pending', fire_at: null, ready_at: null },
  { id: 'rest',  step_number: 2, estimated_duration: 120, status: 'pending', fire_at: null, ready_at: null },
  { id: 'sauce', step_number: 3, estimated_duration:  60, status: 'pending', fire_at: null, ready_at: null },
  { id: 'plate', step_number: 4, estimated_duration:  60, status: 'pending', fire_at: null, ready_at: null },
];

describe('reschedule', () => {
  describe('all steps pending — Ribeye from proposal', () => {
    // target_serve_time = T+420s (7 min total)
    // Expected backward schedule:
    //   Plate : fire_at=360  ready_at=420
    //   Sauce : fire_at=300  ready_at=360
    //   Rest  : fire_at=180  ready_at=300
    //   Sear  : fire_at=0    ready_at=180

    const result = reschedule([
      { order_item_id: 'oi-ribeye', target_serve_time: T(420), steps: ribeyeStepsPending() },
    ]);

    const byId = Object.fromEntries(result.map(s => [s.id, s]));

    it('schedules Sear at fire_at=0, ready_at=180s', () => {
      expect(byId['sear'].fire_at).toEqual(T(0));
      expect(byId['sear'].ready_at).toEqual(T(180));
    });

    it('schedules Rest at fire_at=180s, ready_at=300s', () => {
      expect(byId['rest'].fire_at).toEqual(T(180));
      expect(byId['rest'].ready_at).toEqual(T(300));
    });

    it('schedules Sauce at fire_at=300s, ready_at=360s', () => {
      expect(byId['sauce'].fire_at).toEqual(T(300));
      expect(byId['sauce'].ready_at).toEqual(T(360));
    });

    it('schedules Plate at fire_at=360s, ready_at=420s (== target_serve_time)', () => {
      expect(byId['plate'].fire_at).toEqual(T(360));
      expect(byId['plate'].ready_at).toEqual(T(420));
    });

    it('returns one ScheduledStep per step', () => {
      expect(result).toHaveLength(4);
    });
  });

  describe('frozen steps', () => {
    it('preserves fire_at and ready_at for completed and in_progress steps', () => {
      // Sear completed on time; Rest started 20s late (fire_at=200s instead of 180s).
      const steps: StepInput[] = [
        { id: 'sear',  step_number: 1, estimated_duration: 180, status: 'completed',
          fire_at: T(0),   ready_at: T(180) },
        { id: 'rest',  step_number: 2, estimated_duration: 120, status: 'in_progress',
          fire_at: T(200), ready_at: T(320) },
        { id: 'sauce', step_number: 3, estimated_duration:  60, status: 'pending',
          fire_at: null, ready_at: null },
        { id: 'plate', step_number: 4, estimated_duration:  60, status: 'pending',
          fire_at: null, ready_at: null },
      ];

      const result = reschedule([
        { order_item_id: 'oi-ribeye', target_serve_time: T(420), steps },
      ]);
      const byId = Object.fromEntries(result.map(s => [s.id, s]));

      // Frozen steps are untouched
      expect(byId['sear'].fire_at).toEqual(T(0));
      expect(byId['sear'].ready_at).toEqual(T(180));
      expect(byId['rest'].fire_at).toEqual(T(200));
      expect(byId['rest'].ready_at).toEqual(T(320));

      // Pending steps still computed backward from target_serve_time
      expect(byId['sauce'].fire_at).toEqual(T(300));
      expect(byId['sauce'].ready_at).toEqual(T(360));
      expect(byId['plate'].fire_at).toEqual(T(360));
      expect(byId['plate'].ready_at).toEqual(T(420));
    });

    it('uses fire_at of a frozen step as the anchor for preceding pending steps', () => {
      // Rest is in_progress with a delayed fire_at of 200s (should have been 180s).
      // Sear is still pending (hypothetical out-of-order scenario).
      // Sear's ready_at should be anchored to Rest's fire_at (200s), not the
      // backward-computed value (180s).
      const steps: StepInput[] = [
        { id: 'sear',  step_number: 1, estimated_duration: 180, status: 'pending',
          fire_at: null, ready_at: null },
        { id: 'rest',  step_number: 2, estimated_duration: 120, status: 'in_progress',
          fire_at: T(200), ready_at: T(320) },
        { id: 'sauce', step_number: 3, estimated_duration:  60, status: 'pending',
          fire_at: null, ready_at: null },
        { id: 'plate', step_number: 4, estimated_duration:  60, status: 'pending',
          fire_at: null, ready_at: null },
      ];

      const result = reschedule([
        { order_item_id: 'oi-ribeye', target_serve_time: T(420), steps },
      ]);
      const byId = Object.fromEntries(result.map(s => [s.id, s]));

      // Sear's ready_at anchors to Rest's fire_at (200s), so fire_at = 200 - 180 = 20s
      expect(byId['sear'].ready_at).toEqual(T(200));
      expect(byId['sear'].fire_at).toEqual(T(20));
    });
  });

  describe('multiple order items', () => {
    it('schedules each order item independently from its own target_serve_time', () => {
      // Pasta Carbonara: Boil(180s) → Toss(60s) → Plate(60s), target=T+300s (5 min)
      // Caesar Salad:    Prep(90s)  → Plate(30s),              target=T+120s (2 min)
      const pasta: OrderItemWithSteps = {
        order_item_id: 'oi-pasta',
        target_serve_time: T(300),
        steps: [
          { id: 'boil',        step_number: 1, estimated_duration: 180, status: 'pending', fire_at: null, ready_at: null },
          { id: 'toss',        step_number: 2, estimated_duration:  60, status: 'pending', fire_at: null, ready_at: null },
          { id: 'pasta-plate', step_number: 3, estimated_duration:  60, status: 'pending', fire_at: null, ready_at: null },
        ],
      };

      const salad: OrderItemWithSteps = {
        order_item_id: 'oi-salad',
        target_serve_time: T(120),
        steps: [
          { id: 'prep',        step_number: 1, estimated_duration:  90, status: 'pending', fire_at: null, ready_at: null },
          { id: 'salad-plate', step_number: 2, estimated_duration:  30, status: 'pending', fire_at: null, ready_at: null },
        ],
      };

      const result = reschedule([pasta, salad]);
      const byId = Object.fromEntries(result.map(s => [s.id, s]));

      // Pasta: fire_at=0, Toss=180, Plate=240, ready_at of last=300
      expect(byId['boil'].fire_at).toEqual(T(0));
      expect(byId['boil'].ready_at).toEqual(T(180));
      expect(byId['toss'].fire_at).toEqual(T(180));
      expect(byId['pasta-plate'].ready_at).toEqual(T(300));

      // Salad: Prep fire_at=0, ready_at=90; Plate fire_at=90, ready_at=120
      expect(byId['prep'].fire_at).toEqual(T(0));
      expect(byId['prep'].ready_at).toEqual(T(90));
      expect(byId['salad-plate'].fire_at).toEqual(T(90));
      expect(byId['salad-plate'].ready_at).toEqual(T(120));

      expect(result).toHaveLength(5);
    });
  });
});
