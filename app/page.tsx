import WalletSyncBar from '@/components/WalletSyncBar';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] text-zinc-100">
      <div className="page-pulse" />
      <div className="relative h-40 w-40">
        {/* Track ring */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#27272a"
            className="arc-breathe"
          />
        </svg>

        {/* Spinning + pulsing arc */}
        <svg
          className="absolute inset-0 h-full w-full arc-spin-pulse"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" className="arc-stop-start" />
              <stop offset="100%" className="arc-stop-end" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="url(#arcGradient)"
            strokeLinecap="round"
            strokeDasharray="70 200"
            className="arc-breathe"
          />
        </svg>
      </div>

      <p className="mt-8 text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
        Initialization ✅
      </p>
      <p className="mt-2 text-sm font-medium uppercase tracking-[0.3em] text-zinc-500">
        Building ✅
      </p>
      <p className="mt-2 text-sm font-medium uppercase tracking-[0.3em] text-zinc-400">
        Syncing{' '}
        <span className="bolt bolt-1">⚡</span>
        <span className="bolt bolt-2">⚡</span>
        <span className="bolt bolt-3">⚡</span>
      </p>

      <WalletSyncBar />
    </main>
  );
}
