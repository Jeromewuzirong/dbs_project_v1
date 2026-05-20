import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import OrderForm from '@/components/front/OrderForm';
import type { MenuItem } from '@/lib/types';

export default async function OrderPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('menu_items')
    .select('id, name, created_at')
    .order('name');

  const menuItems: MenuItem[] = data ?? [];

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/"
            className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer"
          >
            ← Home
          </Link>
          <h1 className="text-2xl font-black tracking-tight">Place Order</h1>
        </div>

        {menuItems.length === 0 ? (
          <p className="text-gray-500">No menu items found in the database.</p>
        ) : (
          <OrderForm menuItems={menuItems} />
        )}
      </div>
    </main>
  );
}
