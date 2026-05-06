import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

// Deletes all rows from all three tables in dependency order.
// UUID tables: use neq('id', nil-UUID) as the required filter to delete all rows.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export async function POST() {
  const { error: stepsErr } = await adminClient
    .from('order_steps')
    .delete()
    .neq('id', NIL_UUID);

  if (stepsErr) {
    return NextResponse.json(
      { error: 'Failed to delete order_steps', detail: stepsErr.message },
      { status: 500 },
    );
  }

  const { error: itemsErr } = await adminClient
    .from('order_items')
    .delete()
    .neq('id', NIL_UUID);

  if (itemsErr) {
    return NextResponse.json(
      { error: 'Failed to delete order_items', detail: itemsErr.message },
      { status: 500 },
    );
  }

  const { error: ordersErr } = await adminClient
    .from('orders')
    .delete()
    .neq('id', NIL_UUID);

  if (ordersErr) {
    return NextResponse.json(
      { error: 'Failed to delete orders', detail: ordersErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
