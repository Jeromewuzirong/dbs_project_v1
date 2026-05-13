import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export async function GET() {
  const { data, error } = await adminClient
    .from('chefs')
    .select('id, name, station_id, stations(name, display_order)')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  let body: { name?: string; station_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, station_id } = body;
  if (!name?.trim() || !station_id) {
    return NextResponse.json({ error: 'name and station_id are required' }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from('chefs')
    .insert({ name: name.trim(), station_id })
    .select('id, name, station_id, stations(name, display_order)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
