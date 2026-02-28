'use client';

import Image from 'next/image';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { DougTrade } from '@/lib/types';

interface Props {
  activity: DougTrade[];
  loading: boolean;
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function OutcomeChip({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  const isYes = outcome.toUpperCase() === 'YES';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
        isYes ? 'bg-blue-950 text-blue-400' : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      {outcome}
    </span>
  );
}

function ResolutionChip({
  marketClosed,
  pnl,
}: {
  marketClosed: boolean;
  pnl: number | null;
}) {
  if (!marketClosed) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-amber-950 text-amber-400">
        PENDING
      </span>
    );
  }

  const won = pnl != null && pnl > 0;
  const pnlStr = pnl != null ? fmtUsd(Math.abs(pnl)) : '';
  const sign = pnl != null && pnl > 0 ? '+' : '-';

  if (won) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-emerald-950 text-emerald-400">
        WON {sign}${Math.abs(pnl!).toFixed(2)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-red-950 text-red-400">
      LOST {pnlStr ? `-$${Math.abs(pnl!).toFixed(2)}` : ''}
    </span>
  );
}

export default function ActivityFeed({ activity, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="h-10 w-10 rounded-lg bg-zinc-800 shrink-0" />
            <div className="flex-1">
              <div className="h-3 w-2/3 bg-zinc-800 rounded mb-2" />
              <div className="h-2.5 w-1/3 bg-zinc-800 rounded" />
            </div>
            <div className="h-3 w-16 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        No trades yet — waiting for first sync.
      </p>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/60">
      {activity.map((trade) => {
        const ts = trade.copied_at
          ? formatDistanceToNow(parseISO(trade.copied_at), { addSuffix: true })
          : null;
        const href = trade.slug
          ? `https://polymarket.com/event/${trade.slug}`
          : `https://polymarket.com`;

        return (
          <div key={trade.condition_id} className="flex items-center gap-3 py-4 group">
            {/* Icon */}
            <div className="h-10 w-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700/50">
              {trade.icon_url ? (
                <Image
                  src={trade.icon_url}
                  alt=""
                  width={40}
                  height={40}
                  className="object-cover h-full w-full"
                  unoptimized
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-zinc-600 text-xs font-bold">
                  PM
                </div>
              )}
            </div>

            {/* Title + meta */}
            <div className="flex-1 min-w-0">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-zinc-200 group-hover:text-white transition-colors line-clamp-1 font-medium"
                title={trade.title}
              >
                {trade.title}
              </a>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <OutcomeChip outcome={trade.outcome} />
                <ResolutionChip
                  marketClosed={trade.market_closed}
                  pnl={trade.resolution_pnl}
                />
                {ts && <span className="text-xs text-zinc-600">{ts}</span>}
              </div>
            </div>

            {/* Flat size */}
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums text-zinc-200">
                {fmtUsd(Number(trade.flat_size))}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
