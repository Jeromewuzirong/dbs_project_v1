import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: step, error: stepErr } = await adminClient
    .from('order_steps').select('status').eq('id', id).single();

  if (stepErr || !step) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 });
  }
  if (step.status !== 'fired' && step.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot start a step with status '${step.status}'` },
      { status: 409 },
    );
  }

  const { data: updated, error: updateErr } = await adminClient
    .from('order_steps')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: 'Failed to start step', detail: updateErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ step: updated }, { status: 200 });
}
