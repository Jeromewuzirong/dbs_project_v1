import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ChefManager from '@/components/expeditor/ChefManager';

export default async function ChefsPage() {
  const supabase = await createClient();

  const { data: stations } = await supabase
    .from('stations')
    .select('id, name, display_order')
    .order('display_order');

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/"
            className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer"
          >
            ← Home
          </Link>
          <Link
            href="/dashboard"
            className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer"
          >
            Dashboard
          </Link>
          <h1 className="text-2xl font-black tracking-tight">Manage Chefs</h1>
        </div>

        <ChefManager stations={stations ?? []} />
      </div>
    </main>
  );
}
