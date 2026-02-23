'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { Snapshot } from '@/lib/types';

interface Props {
  snapshots: Snapshot[];
}

function fmtUsd(v: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
}

interface TooltipPayload {
  value: number;
  payload: { captured_at: string; tracker_pnl: number };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const ts = d.payload.captured_at;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400">{format(parseISO(ts), 'MMM d, HH:mm')}</p>
      <p className={`font-semibold mt-0.5 ${d.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmtUsd(d.value)}
      </p>
    </div>
  );
}

export default function PnLChart({ snapshots }: Props) {
  if (snapshots.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-zinc-600">
        {snapshots.length === 0
          ? 'No data yet — first snapshot incoming…'
          : 'Collecting data — chart will appear after the next sync'}
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    captured_at: s.captured_at,
    tracker_pnl: Number(s.tracker_pnl),
  }));

  const pnlValues = data.map((d) => d.tracker_pnl);
  const minPnl = Math.min(...pnlValues);
  const maxPnl = Math.max(...pnlValues);
  const pad = Math.max(Math.abs(maxPnl - minPnl) * 0.15, 200);

  const latest = data.at(-1)?.tracker_pnl ?? 0;
  const lineColor = latest >= 0 ? '#10b981' : '#ef4444';

  // X-axis tick formatter — show time if same day, else date
  const first = parseISO(data[0].captured_at);
  const last  = parseISO(data.at(-1)!.captured_at);
  const sameDay = format(first, 'yyyyMMdd') === format(last, 'yyyyMMdd');
  const xFmt = (v: string) => {
    try { return format(parseISO(v), sameDay ? 'HH:mm' : 'MMM d'); }
    catch { return v; }
  };

  // Only show a subset of ticks to avoid crowding
  const tickCount = Math.min(6, data.length);
  const step = Math.floor(data.length / tickCount);
  const ticks = data
    .filter((_, i) => i % step === 0 || i === data.length - 1)
    .map((d) => d.captured_at);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="captured_at"
          ticks={ticks}
          tickFormatter={xFmt}
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: '#3f3f46' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtUsd}
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={72}
          domain={[minPnl - pad, maxPnl + pad]}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="tracker_pnl"
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
