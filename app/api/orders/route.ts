import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { reschedule } from '@/lib/scheduler';
import type { OrderItemWithSteps } from '@/lib/scheduler';

// pg_advisory_xact_lock requires a direct Postgres connection (not PostgREST).
// For order creation there is no concurrency risk — each order gets a new UUID.
// The lock will be wired in via DATABASE_URL when the step-completion route is built.

interface CreateOrderBody {
  table_number: number;
  items: string[];  // menu_item_id[]
}

export async function POST(request: Request) {
  // --- Parse & validate --------------------------------------------------
  let body: CreateOrderBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { table_number, items } = body;
  if (
    typeof table_number !== 'number' ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  // --- Compute target_serve_time from recipe durations ------------------
  // target = now + max(total_duration per distinct dish) + 10s buffer
  const uniqueItemIds = [...new Set(items)];
  const { data: durationRows, error: durErr } = await adminClient
    .from('recipe_steps')
    .select('menu_item_id, estimated_duration')
    .in('menu_item_id', uniqueItemIds);

  if (durErr || !durationRows) {
    return NextResponse.json(
      { error: 'Failed to fetch recipe durations', detail: durErr?.message },
      { status: 500 },
    );
  }

  const durationByItem: Record<string, number> = {};
  for (const rs of durationRows) {
    durationByItem[rs.menu_item_id] = (durationByItem[rs.menu_item_id] ?? 0) + rs.estimated_duration;
  }
  const maxDuration = Math.max(...uniqueItemIds.map(id => durationByItem[id] ?? 0));
  const target_serve_time = new Date(Date.now() + (maxDuration + 10) * 1000).toISOString();

  // --- 1. Insert order ---------------------------------------------------
  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .insert({ table_number, target_serve_time, status: 'active' })
    .select()
    .single();

  if (orderErr || !order) {
    return NextResponse.json(
      { error: 'Failed to create order', detail: orderErr?.message },
      { status: 500 },
    );
  }

  // Best-effort cleanup on any subsequent failure.
  // order_items and order_steps have no CASCADE DELETE in v1 schema,
  // so children are removed before the parent.
  async function rollback() {
    const { data: ois } = await adminClient
      .from('order_items')
      .select('id')
      .eq('order_id', order.id);
    if (ois && ois.length > 0) {
      await adminClient
        .from('order_steps')
        .delete()
        .in('order_item_id', ois.map(r => r.id));
    }
    await adminClient.from('order_items').delete().eq('order_id', order.id);
    await adminClient.from('orders').delete().eq('id', order.id);
  }

  // --- 2. Insert order_items --------------------------------------------
  const { data: orderItems, error: itemsErr } = await adminClient
    .from('order_items')
    .insert(items.map(menu_item_id => ({ order_id: order.id, menu_item_id })))
    .select();

  if (itemsErr || !orderItems) {
    await adminClient.from('orders').delete().eq('id', order.id);
    return NextResponse.json(
      { error: 'Failed to create order items', detail: itemsErr?.message },
      { status: 500 },
    );
  }

  // --- 3. Fetch recipe_steps + insert order_steps -----------------------
  const allOrderSteps: Record<string, unknown>[] = [];

  for (const oi of orderItems) {
    const { data: recipe, error: recipeErr } = await adminClient
      .from('recipe_steps')
      .select('*')
      .eq('menu_item_id', oi.menu_item_id)
      .order('step_number', { ascending: true });

    if (recipeErr || !recipe || recipe.length === 0) {
      await rollback();
      return NextResponse.json(
        { error: `No recipe steps found for menu_item ${oi.menu_item_id}` },
        { status: 500 },
      );
    }

    const { data: steps, error: stepsErr } = await adminClient
      .from('order_steps')
      .insert(
        recipe.map(rs => ({
          order_item_id:      oi.id,
          recipe_step_id:     rs.id,
          station_id:         rs.station_id,
          step_number:        rs.step_number,
          name:               rs.name,
          estimated_duration: rs.estimated_duration,
        })),
      )
      .select();

    if (stepsErr || !steps) {
      await rollback();
      return NextResponse.json(
        { error: 'Failed to insert order steps', detail: stepsErr?.message },
        { status: 500 },
      );
    }

    allOrderSteps.push(...steps);
  }

  // --- 4. Run reschedule() ----------------------------------------------
  const input: OrderItemWithSteps[] = orderItems.map(oi => ({
    order_item_id: oi.id,
    target_serve_time: new Date(order.target_serve_time),
    steps: allOrderSteps
      .filter(s => s.order_item_id === oi.id)
      .map(s => ({
        id:                 s.id as string,
        step_number:        s.step_number as number,
        estimated_duration: s.estimated_duration as number,
        status:             s.status as Parameters<typeof reschedule>[0][0]['steps'][0]['status'],
        fire_at:            s.fire_at  ? new Date(s.fire_at  as string) : null,
        ready_at:           s.ready_at ? new Date(s.ready_at as string) : null,
      })),
  }));

  const scheduled = reschedule(input);

  // --- 5. Write fire_at / ready_at back (one UPDATE per step) ----------
  const updateResults = await Promise.all(
    scheduled.map(s =>
      adminClient
        .from('order_steps')
        .update({
          fire_at:  s.fire_at.toISOString(),
          ready_at: s.ready_at.toISOString(),
        })
        .eq('id', s.id),
    ),
  );

  const failedUpdate = updateResults.find(r => r.error);
  if (failedUpdate) {
    await rollback();
    return NextResponse.json(
      { error: 'Failed to write schedule', detail: failedUpdate.error?.message },
      { status: 500 },
    );
  }

  // --- 6. Fire steps whose fire_at is now or already past --------------
  const now          = new Date();
  const stepsToFire  = scheduled.filter(s => s.fire_at <= now);

  if (stepsToFire.length > 0) {
    const fireResults = await Promise.all(
      stepsToFire.map(s =>
        adminClient
          .from('order_steps')
          .update({ status: 'fired' })
          .eq('id', s.id),
      ),
    );
    const failedFire = fireResults.find(r => r.error);
    if (failedFire) {
      await rollback();
      return NextResponse.json(
        { error: 'Failed to fire initial steps', detail: failedFire.error?.message },
        { status: 500 },
      );
    }
  }

  const firedIds = new Set(stepsToFire.map(s => s.id));

  // --- 7. Return full order with items + steps --------------------------
  const scheduledById = Object.fromEntries(scheduled.map(s => [s.id, s]));

  const responseItems = orderItems.map(oi => ({
    ...oi,
    steps: allOrderSteps
      .filter(s => s.order_item_id === oi.id)
      .map(s => ({
        ...s,
        status:   firedIds.has(s.id as string) ? 'fired' : s.status,
        fire_at:  scheduledById[s.id as string].fire_at.toISOString(),
        ready_at: scheduledById[s.id as string].ready_at.toISOString(),
      })),
  }));

  return NextResponse.json({ order, items: responseItems }, { status: 201 });
}
