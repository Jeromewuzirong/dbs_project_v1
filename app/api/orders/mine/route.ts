import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');

  if (!customerId) return NextResponse.json([]);

  const { data, error } = await adminClient
    .from('orders')
    .select(`
      id, table_number, status, target_serve_time, created_at,
      order_items (
        id,
        menu_items ( name ),
        order_steps ( id, step_number, name, status )
      )
    `)
    .eq('clerk_user_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/orders/mine] query error:', error);
    return NextResponse.json(
      { error: error.message, detail: error.details, hint: error.hint, code: error.code },
      { status: 500 },
    );
  }
  return NextResponse.json(data ?? []);
}
