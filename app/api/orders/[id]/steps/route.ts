import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

const STEPS_SELECT = `
  id,
  menu_items ( name ),
  order_steps (
    id,
    step_number,
    name,
    estimated_duration,
    actual_duration,
    status,
    stations ( name ),
    chef:chefs!assigned_chef_id ( name )
  )
`;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await adminClient
    .from('order_items')
    .select(STEPS_SELECT)
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dishes = (data ?? []).map((item: any) => ({
    id: item.id as string,
    dish_name: (item.menu_items?.name ?? 'Unknown dish') as string,
    steps: ((item.order_steps ?? []) as any[])
      .sort((a, b) => a.step_number - b.step_number)
      .map(s => ({
        id: s.id as string,
        step_number: s.step_number as number,
        name: s.name as string,
        station_name: (s.stations?.name ?? null) as string | null,
        chef_name: (s.chef?.name ?? null) as string | null,
        estimated_duration: s.estimated_duration as number,
        actual_duration: s.actual_duration as number | null,
        status: s.status as string,
      })),
  }));

  return NextResponse.json(dishes);
}
