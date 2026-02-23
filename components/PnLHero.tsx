'use client';

import type { Snapshot } from '@/lib/types';

interface Props {
  snapshot: Snapshot | null;
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

function fmtPct(pnl: number, invested: number) {
  const pct = (pnl / invested) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

const INITIAL_INVESTMENT = 17_000;

export default function PnLHero({ snapshot, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 animate-pulse">
        <div className="h-4 w-24 bg-zinc-800 rounded mb-3" />
        <div className="h-12 w-48 bg-zinc-800 rounded mb-2" />
        <div className="h-4 w-32 bg-zinc-800 rounded" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-500">
          Waiting for first sync… the cron runs every minute.
        </p>
      </div>
    );
  }

  const pnl          = Number(snapshot.tracker_pnl);
  const trackerValue = Number(snapshot.tracker_value);
  const isPositive   = pnl >= 0;
  const color        = isPositive ? 'text-emerald-400' : 'text-red-400';
  const border       = isPositive ? 'border-emerald-900/50' : 'border-red-900/50';
  const bg           = isPositive ? 'bg-emerald-950/20' : 'bg-red-950/20';

  return (
    <div className={`rounded-xl border ${border} ${bg} p-6`}>
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-1">
        Net P&amp;L
      </p>

      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`text-5xl font-bold tabular-nums ${color}`}>
          {fmt(pnl)}
        </span>
        <span className={`text-xl font-semibold ${color}`}>
          {fmtPct(pnl, INITIAL_INVESTMENT)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <Stat label="Invested" value={fmt(INITIAL_INVESTMENT)} />
        <Stat label="Est. Value" value={fmt(trackerValue)} />
        <Stat
          label="Profile Value"
          value={fmt(Number(snapshot.profile_value))}
          sub="full portfolio"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-base font-semibold text-zinc-200 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}
