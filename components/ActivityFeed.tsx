'use client';

import Image from 'next/image';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { Activity } from '@/lib/types';

interface Props {
  activity: Activity[];
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

function SideChip({ side }: { side: string | null }) {
  const isBuy = side?.toUpperCase() === 'BUY';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        isBuy ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      {side ?? '—'}
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  const isYes = outcome.toUpperCase() === 'YES';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        isYes ? 'bg-blue-950 text-blue-400' : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      {outcome}
    </span>
  );
}

export default function ActivityFeed({ activity, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="h-9 w-9 rounded-lg bg-zinc-800 shrink-0" />
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
        No activity yet — waiting for first sync.
      </p>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/60">
      {activity.map((act) => {
        const ts = act.event_timestamp
          ? formatDistanceToNow(parseISO(act.event_timestamp), { addSuffix: true })
          : null;
        const href = act.slug
          ? `https://polymarket.com/event/${act.slug}`
          : `https://polymarket.com/@0x8dxd`;

        return (
          <div key={act.condition_id} className="flex items-center gap-3 py-3 group">
            {/* Icon */}
            <div className="h-9 w-9 rounded-lg bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700/50">
              {act.icon_url ? (
                <Image
                  src={act.icon_url}
                  alt=""
                  width={36}
                  height={36}
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
                className="text-sm text-zinc-200 group-hover:text-white transition-colors line-clamp-1 font-medium"
                title={act.title}
              >
                {act.title}
              </a>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <SideChip side={act.side} />
                <OutcomeChip outcome={act.outcome} />
                {act.price != null && (
                  <span className="text-[10px] text-zinc-500">
                    @ {(Number(act.price) * 100).toFixed(1)}¢
                  </span>
                )}
                {ts && <span className="text-[10px] text-zinc-600">{ts}</span>}
              </div>
            </div>

            {/* My stake size */}
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums text-zinc-200">
                {fmtUsd(Number(act.tracker_size))}
              </p>
              <p className="text-[10px] text-zinc-600 tabular-nums">
                {fmtUsd(Number(act.usdc_size))} full
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
