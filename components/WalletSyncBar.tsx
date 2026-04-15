'use client';
import { useEffect, useRef, useState } from 'react';

// 20:37 EST Apr 14 → 9:10 AM EST Apr 15 2026  (EST = UTC-5)
const START_MS = new Date('2026-04-15T01:37:00Z').getTime();
const END_MS   = new Date('2026-04-15T14:10:00Z').getTime();
const TOTAL    = 267344;

function getProgress() {
  return Math.min(1, Math.max(0, (Date.now() - START_MS) / (END_MS - START_MS)));
}

function getSynced(progress: number) {
  return Math.max(1, Math.floor(progress * TOTAL));
}

export default function WalletSyncBar() {
  const fillRef              = useRef<HTMLDivElement>(null);
  const [synced, setSynced]  = useState(() => getSynced(getProgress()));

  // On mount: snap to current position, then start a single CSS transition
  // that runs for exactly the remaining duration — perfectly smooth.
  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;

    const now         = Date.now();
    const initialPct  = Math.min(1, Math.max(0, (now - START_MS) / (END_MS - START_MS)));
    const remainingMs = Math.max(0, END_MS - now);

    // Snap to current position with no animation
    fill.style.transition = 'none';
    fill.style.width      = `${initialPct * 100}%`;

    // One rAF later, kick off a single linear transition to 100%
    const raf = requestAnimationFrame(() => {
      fill.style.transition = `width ${remainingMs}ms linear`;
      fill.style.width      = '100%';
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  // Counter ticks every second — decoupled from the smooth fill
  useEffect(() => {
    const id = setInterval(() => setSynced(getSynced(getProgress())), 50);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-6 w-40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
          Tx Linking
        </span>
        <span className="text-xs font-medium tabular-nums text-zinc-500">
          {synced.toLocaleString()}/{TOTAL.toLocaleString()}
        </span>
      </div>

      {/* Track */}
      <div className="relative h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        {/* Fill — width driven by ref */}
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: '0%',
            background: 'linear-gradient(to right, #eab308, #22c55e)',
            boxShadow: '0 0 8px rgba(34,197,94,0.45)',
          }}
        />
        {/* Shimmer sweeps across the full track */}
        <div className="bar-shimmer" />
      </div>
    </div>
  );
}
