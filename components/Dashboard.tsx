'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchSnapshots, fetchActivity } from '@/lib/supabase';
import type { Snapshot, Activity } from '@/lib/types';
import PnLHero from './PnLHero';
import PnLChart from './PnLChart';
import ActivityFeed from './ActivityFeed';

const POLL_MS = 60_000; // refresh every 60 s (matches cron cadence)

export default function Dashboard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activity,  setActivity]  = useState<Activity[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [snaps, acts] = await Promise.all([
        fetchSnapshots(1440),
        fetchActivity(50),
      ]);
      setSnapshots(snaps as Snapshot[]);
      setActivity(acts as Activity[]);
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

  return (
    <main className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">
            doug_plean_tracker
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
      <PnLHero snapshot={latest} loading={loading && !latest} />

      {/* Chart */}
      <section className="mt-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">P&amp;L Over Time</h2>
          <PnLChart snapshots={snapshots} />
        </div>
      </section>

      {/* Activity Feed */}
      <section className="mt-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">
            Activity&nbsp;
            <span className="text-zinc-600 font-normal">
              ({activity.length} unique market{activity.length !== 1 ? 's' : ''})
            </span>
          </h2>
          <ActivityFeed activity={activity} loading={loading && activity.length === 0} />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-zinc-700">
        Tracking a 2.52% proportional stake · $17,000 invested Jan 13 2026 ·{' '}
        Refreshes every minute
      </footer>
    </main>
  );
}
