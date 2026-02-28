'use client';

import type { Snapshot } from '@/lib/types';

interface Props {
  snapshots: Snapshot[];
  loading: boolean;
}

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  }).format(n);
}

function fmtPct(change: number, base: number) {
  if (base === 0) return '+0.0%';
  const pct = (change / base) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

const INITIAL_INVESTMENT = 17_544.83;

export default function PnLHero({ snapshots, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 animate-pulse">
        <div className="h-4 w-24 bg-zinc-800 rounded mb-3" />
        <div className="h-12 w-48 bg-zinc-800 rounded mb-2" />
        <div className="h-4 w-32 bg-zinc-800 rounded" />
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-500">
          Waiting for first sync… the cron runs every minute.
        </p>
      </div>
    );
  }

  const first        = snapshots[0];
  const latest       = snapshots.at(-1)!;
  const pnl          = Number(latest.tracker_pnl) - Number(first.tracker_pnl);
  const trackerValue = Number(latest.tracker_value);
  const base         = Number(first.tracker_value);
  const isPositive   = pnl >= 0;
  const color        = isPositive ? 'text-emerald-400' : 'text-red-400';
  const border       = isPositive ? 'border-emerald-900/50' : 'border-red-900/50';
  const bg           = isPositive ? 'bg-emerald-950/20' : 'bg-red-950/20';

  return (
    <div className={`rounded-xl border ${border} ${bg} p-6`}>
      <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 mb-1">
        Net P&amp;L
      </p>

      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-3xl md:text-5xl font-bold tabular-nums ${color}`}>
          {fmt(pnl)}
        </span>
        <span className={`text-xl font-semibold ${color}`}>
          {fmtPct(pnl, base)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <Stat label="Starting Balance" value={fmt(INITIAL_INVESTMENT)} />
        <Stat label="Current Balance" value={fmt(trackerValue)} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-200 tabular-nums">{value}</p>
    </div>
  );
}
