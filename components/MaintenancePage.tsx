'use client';

import { useEffect, useRef, useState } from 'react';

// Fixed deploy timestamp — progress is absolute, survives refreshes
const DEPLOY_MS = 1772283652000;

// Phase 1: "updating" — 23% → 100% over 44 minutes
const P1_START_PCT = 23;
const P1_DURATION = 44 * 60 * 1000;

// Phase 2: "initializing" — 0% → 100% over 24 minutes
const P2_DURATION = 24 * 60 * 1000;
const P2_START = DEPLOY_MS + P1_DURATION;

type Phase = 'updating' | 'initializing' | 'done';

function getState(now: number): { phase: Phase; pct: number } {
  const elapsed = now - DEPLOY_MS;

  if (elapsed < P1_DURATION) {
    const p = P1_START_PCT + ((100 - P1_START_PCT) * elapsed) / P1_DURATION;
    return { phase: 'updating', pct: Math.min(Math.max(p, P1_START_PCT), 100) };
  }

  const p2Elapsed = now - P2_START;
  if (p2Elapsed < P2_DURATION) {
    const p = (100 * p2Elapsed) / P2_DURATION;
    return { phase: 'initializing', pct: Math.min(Math.max(p, 0), 100) };
  }

  return { phase: 'done', pct: 100 };
}

export default function MaintenancePage() {
  const fillRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState<string>(() => {
    const { phase } = getState(Date.now());
    return phase === 'done' ? 'initializing' : phase;
  });

  useEffect(() => {
    let raf: number;

    function tick() {
      const { phase, pct } = getState(Date.now());

      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (pctRef.current) pctRef.current.textContent = `${Math.floor(pct)}%`;

      const newLabel = phase === 'done' ? 'initializing' : phase;
      setLabel((prev) => (prev !== newLabel ? newLabel : prev));

      if (phase !== 'done') {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="maint-page">
      <header className="maint-header">
        <h1>doug_plean_tracker</h1>
      </header>

      <div className="maint-center">
        <div className="maint-spinner-wrap">
          <div className="maint-spinner-ring" />
          <div className="maint-spinner-dot" />
        </div>

        <p className="maint-status">{label}</p>

        <div className="maint-progress">
          <div className="maint-progress-track">
            <div className="maint-progress-fill" ref={fillRef} />
          </div>
          <div className="maint-progress-meta">
            <span className="maint-progress-pct" ref={pctRef}>
              0%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
