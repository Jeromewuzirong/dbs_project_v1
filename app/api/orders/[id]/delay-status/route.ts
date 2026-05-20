import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import type { DelayStatus } from '@/lib/types';

const DELAY_TOLERANCE_MS = 60 * 1000;

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: order, error: orderErr } = await adminClient
    .from('orders').select('*').eq('id', id).single();

  if (orderErr || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const { data: orderItems, error: oiErr } = await adminClient
    .from('order_items').select('id').eq('order_id', id);

  if (oiErr || !orderItems) {
    return NextResponse.json({ error: 'Failed to fetch order items' }, { status: 500 });
  }

  const { data: allSteps, error: stepsErr } = await adminClient
    .from('order_steps')
    .select('order_item_id, step_number, status, ready_at')
    .in('order_item_id', orderItems.map(oi => oi.id))
    .order('step_number', { ascending: true });

  if (stepsErr || !allSteps) {
    return NextResponse.json({ error: 'Failed to fetch steps' }, { status: 500 });
  }

  const targetMs = new Date(order.target_serve_time).getTime();
  let delayStatus: DelayStatus = 'on_track';

  // Same ready_at comparison the step-complete route uses
  for (const oi of orderItems) {
    const lastStep = allSteps
      .filter(s => s.order_item_id === oi.id)
      .sort((a, b) => b.step_number - a.step_number)
      .at(0);

    if (!lastStep || lastStep.status === 'completed' || !lastStep.ready_at) continue;

    const overByMs = new Date(lastStep.ready_at).getTime() - targetMs;

    if (overByMs > DELAY_TOLERANCE_MS) {
      delayStatus = 'hard_delay';
      break;
    } else if (overByMs > 0) {
      delayStatus = 'soft_delay';
    }
  }

  // For pending/in_progress steps, ready_at was scheduled relative to
  // target_serve_time (overByMs ≈ 0). If wall-clock time has already
  // passed the target, those steps are definitively late regardless.
  const hasIncompleteSteps = allSteps.some(s => s.status !== 'completed');
  if (hasIncompleteSteps && Date.now() > targetMs) {
    delayStatus = 'hard_delay';
  }

  if (delayStatus === order.delay_status) {
    return NextResponse.json({ delay_status: delayStatus, updated: false }, { status: 200 });
  }

  const { error: updateErr } = await adminClient
    .from('orders').update({ delay_status: delayStatus }).eq('id', id);

  if (updateErr) {
    return NextResponse.json(
      { error: 'Failed to update delay status', detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ delay_status: delayStatus, updated: true }, { status: 200 });
}
