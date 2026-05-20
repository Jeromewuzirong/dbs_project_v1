import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // .select().single() lets us distinguish "not found" (PGRST116) from other errors.
  const { error } = await adminClient
    .from('chefs')
    .delete()
    .eq('id', id)
    .select('id')
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Chef not found' }, { status: 404 });
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
