import { adminClient } from '@/lib/supabase/admin';
import BackButton from './BackButton';

interface ChefStats {
  chefId: string;
  name: string;
  stepsCompleted: number;
  onTimeRate: number; // 0–100
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function LeaderboardPage() {
  const [{ data: steps, error: stepsError }, { data: chefs, error: chefsError }] =
    await Promise.all([
      adminClient
        .from('order_steps')
        .select('assigned_chef_id, estimated_duration, actual_duration')
        .eq('status', 'completed')
        .not('assigned_chef_id', 'is', null),
      adminClient
        .from('chefs')
        .select('id, name'),
    ]);

  if (stepsError || chefsError) {
    const msg = stepsError?.message ?? chefsError?.message;
    return (
      <main className="min-h-screen bg-gray-950 text-white p-6">
        <p className="text-red-400">Failed to load leaderboard: {msg}</p>
      </main>
    );
  }

  const chefNames = new Map((chefs ?? []).map(c => [c.id, c.name]));

  console.log('[leaderboard] chefs fetched:', chefs?.length ?? 0, [...chefNames.entries()]);
  console.log('[leaderboard] sample assigned_chef_ids:', steps?.slice(0, 5).map(s => s.assigned_chef_id));

  const byChef = new Map<string, { total: number; onTime: number }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (steps ?? []) as any[]) {
    if (row.actual_duration === null) continue;

    const id: string = row.assigned_chef_id;
    if (!byChef.has(id)) byChef.set(id, { total: 0, onTime: 0 });

    const c = byChef.get(id)!;
    c.total += 1;
    if (row.actual_duration <= row.estimated_duration) c.onTime += 1;
  }

  const stats: ChefStats[] = [...byChef.entries()]
    .map(([chefId, c]) => ({
      chefId,
      name:           chefNames.get(chefId) ?? `Unknown (${chefId.slice(0, 8)})`,
      stepsCompleted: c.total,
      onTimeRate:     c.total > 0 ? (c.onTime / c.total) * 100 : 0,
    }))
    .sort((a, b) =>
      b.onTimeRate - a.onTimeRate || b.stepsCompleted - a.stepsCompleted,
    );

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center gap-4">
        <BackButton />
        <h1 className="text-lg font-bold tracking-wide">Chef Leaderboard</h1>
        <span className="text-sm text-gray-500">{stats.length} chef{stats.length !== 1 ? 's' : ''}</span>
      </header>

      <div className="p-6 overflow-x-auto">
        {stats.length === 0 ? (
          <p className="text-center text-gray-500 py-24 text-sm">No completed steps yet.</p>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
                <th className="pb-3 pr-6 font-semibold">Rank</th>
                <th className="pb-3 pr-8 font-semibold">Chef</th>
                <th className="pb-3 pr-8 font-semibold text-right">Steps</th>
                <th className="pb-3 font-semibold text-right">On-time</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((chef, i) => (
                <tr
                  key={chef.chefId}
                  className="border-b border-gray-800/50 hover:bg-gray-900/40 transition-colors"
                >
                  <td className="py-3 pr-6 w-10">
                    {MEDALS[i] !== undefined && (
                      <span className="text-xl">{MEDALS[i]}</span>
                    )}
                  </td>
                  <td className="py-3 pr-8 font-semibold text-white">{chef.name}</td>
                  <td className="py-3 pr-8 text-gray-300 tabular-nums text-right">
                    {chef.stepsCompleted}
                  </td>
                  <td className={`py-3 tabular-nums font-semibold text-right ${
                    chef.onTimeRate >= 80 ? 'text-green-400' :
                    chef.onTimeRate >= 60 ? 'text-amber-400' :
                                            'text-red-400'
                  }`}>
                    {chef.onTimeRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
