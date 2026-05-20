import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

const CHEF_SELECT = 'id, name, created_at, chef_stations(station_id, stations(id, name, display_order))';

export async function GET() {
  const { data, error } = await adminClient
    .from('chefs')
    .select(CHEF_SELECT)
    .order('name');

  console.log('[GET /api/chefs] rows:', data?.length ?? 'null', '| error:', error?.message ?? 'none', '| code:', error?.code ?? '-');

  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  let body: { name?: string; stations?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, stations } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Array.isArray(stations) || stations.length === 0) {
    return NextResponse.json({ error: 'at least one station is required' }, { status: 400 });
  }

  const { data: chef, error: chefErr } = await adminClient
    .from('chefs')
    .insert({ name: name.trim() })
    .select('id')
    .single();

  if (chefErr || !chef) {
    return NextResponse.json(
      { error: chefErr?.message ?? 'Failed to create chef' },
      { status: 500 },
    );
  }

  const { error: stationsErr } = await adminClient
    .from('chef_stations')
    .insert(stations.map(sid => ({ chef_id: chef.id, station_id: sid })));

  if (stationsErr) {
    await adminClient.from('chefs').delete().eq('id', chef.id);
    return NextResponse.json({ error: stationsErr.message }, { status: 500 });
  }

  const { data: fullChef, error: fetchErr } = await adminClient
    .from('chefs')
    .select(CHEF_SELECT)
    .eq('id', chef.id)
    .single();

  if (fetchErr || !fullChef) {
    return NextResponse.json({ error: 'Chef created but could not be fetched' }, { status: 500 });
  }

  return NextResponse.json(fullChef, { status: 201 });
}
