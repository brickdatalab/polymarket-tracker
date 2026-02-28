'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchDougSnapshots, fetchDougTrades } from '@/lib/supabase';
import type { Snapshot, DougTrade } from '@/lib/types';
import PnLHero from './PnLHero';
import PnLChart from './PnLChart';
import ActivityFeed from './ActivityFeed';

const POLL_MS = 60_000; // refresh every 60 s (matches cron cadence)

type TimeRange = 'all' | '1m' | '1w' | '1d';

/** Keep only the last snapshot per calendar day — eliminates minute-level flat lines */
function deduplicateByDay(snapshots: Snapshot[]): Snapshot[] {
  const byDay = new Map<string, Snapshot>();
  for (const s of snapshots) {
    const day = s.captured_at.slice(0, 10); // "2026-01-19"
    byDay.set(day, s); // last one wins (array is sorted ascending)
  }
  return Array.from(byDay.values());
}

function filterSnapshots(snapshots: Snapshot[], range: TimeRange): Snapshot[] {
  const deduped = deduplicateByDay(snapshots);
  if (range === 'all') return deduped;
  const now = new Date();
  const cutoff = new Date();
  if (range === '1m') cutoff.setDate(now.getDate() - 30);
  if (range === '1w') cutoff.setDate(now.getDate() - 7);
  if (range === '1d') cutoff.setDate(now.getDate() - 1);
  return deduped.filter(s => new Date(s.captured_at) >= cutoff);
}

export default function Dashboard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activity,  setActivity]  = useState<DougTrade[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  const load = useCallback(async () => {
    try {
      const [snaps, acts] = await Promise.all([
        fetchDougSnapshots(1440),
        fetchDougTrades(200),
      ]);
      setSnapshots(snaps as Snapshot[]);
      setActivity(acts as DougTrade[]);
      setLastSync(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Poll every 60 s
  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Refresh on tab focus
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const latest = snapshots.at(-1) ?? null;
  const filteredSnaps = filterSnapshots(snapshots, timeRange);

  return (
    <main className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">
            doug_tracker
          </h1>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {/* Live pulse */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>
            {loading && !latest
              ? 'Loading…'
              : lastSync
              ? `Updated ${lastSync.toLocaleTimeString()}`
              : 'Live'}
          </span>
        </div>
      </header>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* P&L Hero */}
      <PnLHero snapshots={filteredSnaps} loading={loading && !latest} />

      {/* Chart */}
      <section className="mt-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-400">P&amp;L Over Time</h2>
            <div className="flex gap-1.5">
              {(['all', '1m', '1w', '1d'] as TimeRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                    timeRange === r
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {r === 'all' ? 'All' : r === '1m' ? '1M' : r === '1w' ? '1W' : '1D'}
                </button>
              ))}
            </div>
          </div>
          <PnLChart snapshots={filteredSnaps} />
        </div>
      </section>

      {/* Activity Feed */}
      <section className="mt-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">
            Trades&nbsp;
            <span className="text-zinc-600 font-normal">
              ({activity.length} position{activity.length !== 1 ? 's' : ''})
            </span>
          </h2>
          <ActivityFeed activity={activity} loading={loading && activity.length === 0} />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-zinc-700">
        Updated every minute
      </footer>
    </main>
  );
}
