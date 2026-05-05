import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { reschedule } from '@/lib/scheduler';
import type { OrderItemWithSteps } from '@/lib/scheduler';
import type { StepStatus } from '@/lib/types';

// TODO: pg_try_advisory_xact_lock(order_id) — needs DATABASE_URL (direct Postgres
// connection). Without it, two concurrent completions on the same order can race on
// the reschedule write. Wire in when DATABASE_URL is available.

const DELAY_TOLERANCE_MS = 60 * 1000;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // --- 1. Fetch + validate the step ------------------------------------
  const { data: step, error: stepErr } = await adminClient
    .from('order_steps').select('*').eq('id', id).single();

  if (stepErr || !step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }
  if (step.status !== 'fired' && step.status !== 'in_progress') {
    return NextResponse.json(
      { error: `Cannot complete a step with status '${step.status}'` },
      { status: 409 },
    );
  }

  // --- 2. Mark step completed ------------------------------------------
  const completedAt = new Date();
  const actualDuration = step.started_at
    ? Math.round((completedAt.getTime() - new Date(step.started_at).getTime()) / 1000)
    : null;

  const { error: completeErr } = await adminClient
    .from('order_steps')
    .update({
      status: 'completed',
      completed_at: completedAt.toISOString(),
      ...(actualDuration !== null && { actual_duration: actualDuration }),
    })
    .eq('id', id);

  if (completeErr) {
    return NextResponse.json(
      { error: 'Failed to complete step', detail: completeErr.message },
      { status: 500 },
    );
  }

  // --- 3. Load order context (after the completion write above) --------
  const { data: orderItem, error: oiErr } = await adminClient
    .from('order_items').select('order_id').eq('id', step.order_item_id).single();

  if (oiErr || !orderItem) {
    return NextResponse.json({ error: 'Order item not found' }, { status: 500 });
  }

  const [
    { data: order,         error: orderErr   },
    { data: allOrderItems, error: allOiErr   },
  ] = await Promise.all([
    adminClient.from('orders').select('*').eq('id', orderItem.order_id).single(),
    adminClient.from('order_items').select('*').eq('order_id', orderItem.order_id),
  ]);

  if (orderErr  || !order)         return NextResponse.json({ error: 'Order not found'             }, { status: 500 });
  if (allOiErr  || !allOrderItems) return NextResponse.json({ error: 'Failed to fetch order items' }, { status: 500 });

  // Fetch every step for the whole order. The completion write already
  // committed, so this step appears here with status='completed'.
  const { data: allSteps, error: allStepsErr } = await adminClient
    .from('order_steps')
    .select('*')
    .in('order_item_id', allOrderItems.map(oi => oi.id))
    .order('step_number', { ascending: true });

  if (allStepsErr || !allSteps) {
    return NextResponse.json({ error: 'Failed to fetch order steps' }, { status: 500 });
  }

  // --- 4. Fire the next step if it is still pending --------------------
  const nextStep = allSteps.find(
    s => s.order_item_id === step.order_item_id && s.step_number === step.step_number + 1,
  );

  if (nextStep && nextStep.status === 'pending') {
    const { error: fireErr } = await adminClient
      .from('order_steps').update({ status: 'fired' }).eq('id', nextStep.id);

    if (fireErr) {
      return NextResponse.json(
        { error: 'Failed to fire next step', detail: fireErr.message },
        { status: 500 },
      );
    }
    // Reflect the DB write in memory so reschedule() and stepsToUpdate see 'fired'
    nextStep.status = 'fired';
  }

  // --- 5. Re-run reschedule() for the entire order ---------------------
  const input: OrderItemWithSteps[] = allOrderItems.map(oi => ({
    order_item_id: oi.id,
    target_serve_time: new Date(order.target_serve_time),
    steps: allSteps
      .filter(s => s.order_item_id === oi.id)
      .map(s => ({
        id:                 s.id,
        step_number:        s.step_number,
        estimated_duration: s.estimated_duration,
        status:             s.status as StepStatus,
        fire_at:            s.fire_at  ? new Date(s.fire_at)  : null,
        ready_at:           s.ready_at ? new Date(s.ready_at) : null,
      })),
  }));

  const scheduled     = reschedule(input);
  const scheduledById = Object.fromEntries(scheduled.map(s => [s.id, s]));

  // --- 6. Write fire_at/ready_at — pending and fired steps only --------
  // completed / in_progress / delayed steps are frozen; skipping them
  // keeps the intent explicit even though writing would be a no-op.
  const stepsToUpdate = allSteps.filter(
    s => s.status === 'pending' || s.status === 'fired',
  );

  if (stepsToUpdate.length > 0) {
    const updateResults = await Promise.all(
      stepsToUpdate.map(s =>
        adminClient.from('order_steps')
          .update({
            fire_at:  scheduledById[s.id].fire_at.toISOString(),
            ready_at: scheduledById[s.id].ready_at.toISOString(),
          })
          .eq('id', s.id),
      ),
    );

    const failedUpdate = updateResults.find(r => r.error);
    if (failedUpdate) {
      return NextResponse.json(
        { error: 'Failed to write updated schedule', detail: failedUpdate.error?.message },
        { status: 500 },
      );
    }
  }

  // --- 7. Compute and persist delay status -----------------------------
  const targetMs = new Date(order.target_serve_time).getTime();
  let delayStatus: 'on_track' | 'soft_delay' | 'hard_delay' = 'on_track';

  for (const oi of allOrderItems) {
    const lastStep = allSteps
      .filter(s => s.order_item_id === oi.id)
      .sort((a, b) => b.step_number - a.step_number)
      .at(0);

    if (!lastStep || lastStep.status === 'completed') continue;

    const overByMs = scheduledById[lastStep.id].ready_at.getTime() - targetMs;

    if (overByMs > DELAY_TOLERANCE_MS) {
      delayStatus = 'hard_delay';
      break;
    } else if (overByMs > 0) {
      delayStatus = 'soft_delay';
    }
  }

  const { error: delayErr } = await adminClient
    .from('orders').update({ delay_status: delayStatus }).eq('id', order.id);

  if (delayErr) {
    return NextResponse.json(
      { error: 'Failed to update delay status', detail: delayErr.message },
      { status: 500 },
    );
  }

  // --- 8. Close order if every step is done ---------------------------
  // allSteps reflects the just-written completion; nextStep.status was mutated
  // to 'fired' in memory above, so this is only true on the very last step.
  const allDone = allSteps.every(s => s.status === 'completed');

  if (allDone) {
    const { error: closeErr } = await adminClient
      .from('orders').update({ status: 'completed' }).eq('id', order.id);

    if (closeErr) {
      return NextResponse.json(
        { error: 'Failed to close order', detail: closeErr.message },
        { status: 500 },
      );
    }
  }

  // --- 9. Return updated order with items + steps ----------------------
  const responseItems = allOrderItems.map(oi => ({
    ...oi,
    steps: allSteps
      .filter(s => s.order_item_id === oi.id)
      .sort((a, b) => a.step_number - b.step_number)
      .map(s => ({
        ...s,
        fire_at:  scheduledById[s.id].fire_at.toISOString(),
        ready_at: scheduledById[s.id].ready_at.toISOString(),
      })),
  }));

  return NextResponse.json(
    {
      order: { ...order, delay_status: delayStatus, ...(allDone && { status: 'completed' }) },
      items: responseItems,
    },
    { status: 200 },
  );
}
