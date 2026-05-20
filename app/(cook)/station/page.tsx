import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import StationView from '@/components/cook/StationView';

export default async function StationPage() {
  const supabase = await createClient();
  const { data: stations } = await supabase
    .from('stations')
    .select('id, name')
    .order('display_order');

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}>
        <StationView stations={stations ?? []} />
      </Suspense>
    </main>
  );
}
