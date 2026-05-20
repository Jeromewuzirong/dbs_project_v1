import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

interface ChefStats {
  chefId: string;
  name: string;
  stepsCompleted: number;
  onTimeRate: number;   // 0–100
  avgDelay: number;     // seconds, late steps only
  score: number;        // onTimeRate * stepsCompleted, 1 dp
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function LeaderboardPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('order_steps')
    .select(`
      assigned_chef_id,
      estimated_duration,
      actual_duration,
      chef:chefs!assigned_chef_id ( name )
    `)
    .eq('status', 'completed')
    .not('assigned_chef_id', 'is', null);

  if (error) {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-6">
        <p className="text-red-400">Failed to load leaderboard: {error.message}</p>
      </main>
    );
  }

  // Aggregate per chef — skip rows where actual_duration is null
  const byChef = new Map<string, {
    name: string;
    total: number;
    onTime: number;
    lateSum: number;
    lateCount: number;
  }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    if (row.actual_duration === null) continue;

    const id: string   = row.assigned_chef_id;
    const name: string = row.chef?.name ?? 'Unknown';

    if (!byChef.has(id)) {
      byChef.set(id, { name, total: 0, onTime: 0, lateSum: 0, lateCount: 0 });
    }

    const c = byChef.get(id)!;
    c.total += 1;

    if (row.actual_duration <= row.estimated_duration) {
      c.onTime += 1;
    } else {
      c.lateSum   += row.actual_duration - row.estimated_duration;
      c.lateCount += 1;
    }
  }

  const stats: ChefStats[] = [...byChef.entries()]
    .map(([chefId, c]) => {
      const onTimeRate = c.total > 0 ? (c.onTime / c.total) * 100 : 0;
      const avgDelay   = c.lateCount > 0 ? Math.round(c.lateSum / c.lateCount) : 0;
      const score      = Math.round(onTimeRate * c.total * 10) / 10;
      return { chefId, name: c.name, stepsCompleted: c.total, onTimeRate, avgDelay, score };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer">
          ← Back
        </Link>
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
                <th className="pb-3 pr-8 font-semibold text-right">On-time</th>
                <th className="pb-3 pr-8 font-semibold text-right">Avg delay</th>
                <th className="pb-3 font-semibold text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((chef, i) => (
                <tr
                  key={chef.chefId}
                  className="border-b border-gray-800/50 hover:bg-gray-900/40 transition-colors"
                >
                  <td className="py-3 pr-6 w-10">
                    {MEDALS[i] !== undefined ? (
                      <span className="text-xl">{MEDALS[i]}</span>
                    ) : (
                      <span className="text-gray-500 font-mono text-sm">#{i + 1}</span>
                    )}
                  </td>
                  <td className="py-3 pr-8 font-semibold text-white">{chef.name}</td>
                  <td className="py-3 pr-8 text-gray-300 tabular-nums text-right">
                    {chef.stepsCompleted}
                  </td>
                  <td className={`py-3 pr-8 tabular-nums font-semibold text-right ${
                    chef.onTimeRate >= 80 ? 'text-green-400' :
                    chef.onTimeRate >= 60 ? 'text-amber-400' :
                                            'text-red-400'
                  }`}>
                    {chef.onTimeRate.toFixed(1)}%
                  </td>
                  <td className="py-3 pr-8 text-gray-400 tabular-nums text-right font-mono text-xs">
                    {chef.avgDelay > 0 ? `+${chef.avgDelay}s` : '—'}
                  </td>
                  <td className="py-3 font-bold tabular-nums text-right text-white">
                    {chef.score.toFixed(1)}
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
