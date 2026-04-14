# Doug Paper Trading Profile — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a paper-trading system ("Doug") that copies predictions from 4 source profiles (f705/cc50/571c/80cd) with $20 flat stakes, starting balance $42, checks market resolution every 30 minutes, and displays results on the existing Vercel dashboard.

**Architecture:** Two new edge functions — a "trade copier" (every minute) that detects new condition_ids across 4 source activity tables and inserts $20 paper trades into `pt_trades_doug`, and a "resolution checker" (every 30 min) that queries the Polymarket CLOB API for market outcomes and calculates PnL. The trade copier also inserts a snapshot row each cycle for the P&L chart. The existing Next.js dashboard is repointed to read from Doug's tables. Two additional empty tables (`pt_trades_vincent`, `pt_trades_juju`) are created for future use.

**Tech Stack:** Supabase Postgres + Edge Functions + pg_cron, Deno, Next.js 14, Polymarket CLOB API (`clob.polymarket.com/markets/{condition_id}`)

---

## API Facts (verified Feb 28 2026)

**Resolution data** — CLOB API: `GET https://clob.polymarket.com/markets/{condition_id}`
- `closed: true/false` — whether market has resolved
- `tokens[].outcome: "Yes"/"No"` — outcome labels
- `tokens[].winner: true/false` — which outcome won
- Query by condition_id (which we store in all tables)

**PnL formula for paper trades (BUY side only):**
```
shares        = flat_size / entry_price
won           = tokens.find(t => t.outcome === bet_outcome).winner
payout        = won ? shares : 0
resolution_pnl = payout - flat_size
```

**What gets copied:**
- Only `type = 'TRADE'` with `side = 'BUY'` from source tables
- Skip `type = 'MERGE'` (post-resolution redemptions, not new predictions)
- Skip `side = 'SELL'` (position exits, not new predictions)
- Deduplicate: if same condition_id appears in multiple source tables, copy only once

---

## Task 1: Create database tables + views

**Migration name:** `create_doug_paper_trading_tables`

**Step 1: Apply migration via `mcp__claude_ai_Supabase__apply_migration`**

```sql
-- Doug paper trades table
CREATE TABLE profile_tracker.pt_trades_doug (
  id serial PRIMARY KEY,
  condition_id text UNIQUE NOT NULL,
  source_table text NOT NULL,          -- 'f705', 'cc50', '571c', '80cd'
  title text NOT NULL,
  slug text,
  outcome text,                        -- what source trader bet on: 'Yes'/'No'
  side text,                           -- always 'BUY' (we only copy buys)
  icon_url text,
  source_usdc_size numeric,            -- original position size from source trader
  flat_size numeric NOT NULL DEFAULT 20, -- $20 flat paper trade
  entry_price numeric,                 -- price at time of copy
  shares numeric,                      -- flat_size / entry_price
  market_closed boolean DEFAULT false,
  winning_outcome text,                -- 'Yes' or 'No' when resolved
  resolution_pnl numeric,             -- calculated on resolution
  resolved_at timestamptz,
  event_timestamp timestamptz,         -- when source trade occurred
  copied_at timestamptz DEFAULT now(),
  last_checked_at timestamptz
);

-- Doug snapshots for P&L chart (matches Snapshot interface shape)
CREATE TABLE profile_tracker.pt_doug_snapshots (
  id serial PRIMARY KEY,
  captured_at timestamptz DEFAULT now(),
  profile_value numeric DEFAULT 0,     -- placeholder (no real portfolio)
  tracker_value numeric NOT NULL,      -- current balance
  tracker_pnl numeric NOT NULL         -- total realized P&L
);

-- Insert initial snapshot (starting balance $42, PnL $0)
INSERT INTO profile_tracker.pt_doug_snapshots (tracker_value, tracker_pnl, profile_value)
VALUES (42, 0, 0);

-- Vincent and Juju (empty, same schema, for future use)
CREATE TABLE profile_tracker.pt_trades_vincent (LIKE profile_tracker.pt_trades_doug INCLUDING ALL);
CREATE TABLE profile_tracker.pt_trades_juju (LIKE profile_tracker.pt_trades_doug INCLUDING ALL);

-- Indexes
CREATE INDEX idx_doug_market_closed ON profile_tracker.pt_trades_doug (market_closed) WHERE market_closed = false;
CREATE INDEX idx_doug_copied_at ON profile_tracker.pt_trades_doug (copied_at DESC);

-- Views (public schema, SELECT-only for anon)
CREATE VIEW public.pt_trades_doug_view AS SELECT * FROM profile_tracker.pt_trades_doug;
CREATE VIEW public.pt_doug_snapshots_view AS SELECT * FROM profile_tracker.pt_doug_snapshots;
CREATE VIEW public.pt_trades_vincent_view AS SELECT * FROM profile_tracker.pt_trades_vincent;
CREATE VIEW public.pt_trades_juju_view AS SELECT * FROM profile_tracker.pt_trades_juju;

-- RLS: permissive SELECT for public role
ALTER TABLE profile_tracker.pt_trades_doug ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON profile_tracker.pt_trades_doug FOR SELECT TO public USING (true);
ALTER TABLE profile_tracker.pt_doug_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON profile_tracker.pt_doug_snapshots FOR SELECT TO public USING (true);
ALTER TABLE profile_tracker.pt_trades_vincent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON profile_tracker.pt_trades_vincent FOR SELECT TO public USING (true);
ALTER TABLE profile_tracker.pt_trades_juju ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON profile_tracker.pt_trades_juju FOR SELECT TO public USING (true);
```

**Step 2: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'profile_tracker'
  AND table_name IN ('pt_trades_doug','pt_trades_vincent','pt_trades_juju','pt_doug_snapshots');
-- expect 4 rows

SELECT * FROM profile_tracker.pt_doug_snapshots;
-- expect 1 row: tracker_value=42, tracker_pnl=0
```

---

## Task 2: Deploy edge function `doug-trade-copier`

Edge function that runs every minute. For each cycle:
1. Query all 4 source tables for TRADE+BUY condition_ids not yet in pt_trades_doug
2. Insert new paper trades with $20 flat stake
3. Calculate current balance and insert a snapshot row

**Step 1: Deploy via `mcp__claude_ai_Supabase__deploy_edge_function`**

Function name: `doug-trade-copier`
verify_jwt: false

```typescript
import postgres from 'npm:postgres';

const FLAT_SIZE = 20;
const INITIAL_BALANCE = 42;

const SOURCE_TABLES = [
  { id: 'f705', table: 'profile_tracker.pt_activity_f705' },
  { id: 'cc50', table: 'profile_tracker.pt_activity_cc50' },
  { id: '571c', table: 'profile_tracker.pt_activity_571c' },
  { id: '80cd', table: 'profile_tracker.pt_activity_80cd' },
];

Deno.serve(async (_req: Request) => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
    prepare: false,
    ssl: 'require',
  });

  try {
    let totalCopied = 0;

    for (const src of SOURCE_TABLES) {
      // Find TRADE+BUY condition_ids in source NOT already in doug
      const newTrades = await sql.unsafe(
        `SELECT s.condition_id, s.title, s.slug, s.outcome, s.side,
                s.icon_url, s.usdc_size, s.price, s.event_timestamp
         FROM ${src.table} s
         LEFT JOIN profile_tracker.pt_trades_doug d ON d.condition_id = s.condition_id
         WHERE d.condition_id IS NULL
           AND s.type = 'TRADE'
           AND s.side = 'BUY'
           AND s.price IS NOT NULL
           AND s.price > 0`
      );

      for (const t of newTrades) {
        const entryPrice = parseFloat(t.price);
        const shares = FLAT_SIZE / entryPrice;

        await sql`
          INSERT INTO profile_tracker.pt_trades_doug
            (condition_id, source_table, title, slug, outcome, side,
             icon_url, source_usdc_size, flat_size, entry_price, shares,
             event_timestamp, copied_at)
          VALUES
            (${t.condition_id}, ${src.id}, ${t.title}, ${t.slug},
             ${t.outcome}, ${t.side}, ${t.icon_url}, ${t.usdc_size},
             ${FLAT_SIZE}, ${entryPrice}, ${Math.round(shares * 10000) / 10000},
             ${t.event_timestamp}, now())
          ON CONFLICT (condition_id) DO NOTHING
        `;
        totalCopied++;
      }
    }

    // Calculate current balance and PnL for snapshot
    const stats = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN market_closed THEN resolution_pnl ELSE 0 END), 0) as total_pnl,
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE market_closed) as resolved_trades
      FROM profile_tracker.pt_trades_doug
    `;

    const totalPnl = parseFloat(stats[0].total_pnl);
    const totalTrades = parseInt(stats[0].total_trades);
    const resolvedTrades = parseInt(stats[0].resolved_trades);
    const pendingTrades = totalTrades - resolvedTrades;

    // Balance = initial + realized PnL - pending costs
    // Each pending trade has $FLAT_SIZE locked up
    const balance = INITIAL_BALANCE + totalPnl - (pendingTrades * FLAT_SIZE);

    // Insert snapshot
    await sql`
      INSERT INTO profile_tracker.pt_doug_snapshots (tracker_value, tracker_pnl, profile_value)
      VALUES (${Math.round(balance * 100) / 100}, ${Math.round(totalPnl * 100) / 100}, 0)
    `;

    await sql.end();

    return new Response(
      JSON.stringify({ ok: true, copied: totalCopied, balance, totalPnl, totalTrades, resolvedTrades }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('doug-trade-copier error:', err);
    try { await sql.end(); } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

**Step 2: Test manually with curl**

```bash
curl -s -X POST 'https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/doug-trade-copier' \
  -H 'Authorization: Bearer {ANON_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expected: `{"ok":true,"copied":N,...}` where N > 0 (copies existing source trades).

**Step 3: Verify rows**

```sql
SELECT COUNT(*) as total,
       source_table,
       COUNT(*) as cnt
FROM profile_tracker.pt_trades_doug
GROUP BY source_table;
-- Should show rows from multiple source tables

SELECT * FROM profile_tracker.pt_doug_snapshots ORDER BY id DESC LIMIT 3;
-- Should show initial snapshot + new snapshot(s) with balance
```

---

## Task 3: Deploy edge function `doug-resolution-checker`

Edge function that runs every 30 minutes. For each cycle:
1. Query all unresolved (market_closed=false) positions from pt_trades_doug
2. For each, query CLOB API for market status
3. If closed: determine winner, calculate PnL, update row

```typescript
import postgres from 'npm:postgres';

const CLOB_API = 'https://clob.polymarket.com';

interface Token {
  outcome: string;
  winner: boolean;
}

interface MarketResponse {
  closed: boolean;
  tokens: Token[];
}

Deno.serve(async (_req: Request) => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
    prepare: false,
    ssl: 'require',
  });

  try {
    // Get all unresolved positions
    const pending = await sql`
      SELECT id, condition_id, outcome, flat_size, shares
      FROM profile_tracker.pt_trades_doug
      WHERE market_closed = false
    `;

    let resolved = 0;
    let errors = 0;

    for (const pos of pending) {
      try {
        const res = await fetch(`${CLOB_API}/markets/${pos.condition_id}`);
        if (!res.ok) {
          errors++;
          continue;
        }

        const market = (await res.json()) as MarketResponse;
        if (!market.closed) continue; // not resolved yet

        // Find winning outcome
        const winner = market.tokens.find((t: Token) => t.winner);
        if (!winner) continue; // edge case: closed but no winner

        const winningOutcome = winner.outcome;
        const betWon = pos.outcome === winningOutcome;
        const payout = betWon ? parseFloat(pos.shares) : 0;
        const pnl = payout - parseFloat(pos.flat_size);

        await sql`
          UPDATE profile_tracker.pt_trades_doug
          SET market_closed = true,
              winning_outcome = ${winningOutcome},
              resolution_pnl = ${Math.round(pnl * 100) / 100},
              resolved_at = now(),
              last_checked_at = now()
          WHERE id = ${pos.id}
        `;
        resolved++;
      } catch {
        errors++;
      }
    }

    // Update last_checked_at for unresolved positions too
    await sql`
      UPDATE profile_tracker.pt_trades_doug
      SET last_checked_at = now()
      WHERE market_closed = false
    `;

    await sql.end();

    return new Response(
      JSON.stringify({
        ok: true,
        pending: pending.length,
        resolved,
        errors,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('doug-resolution-checker error:', err);
    try { await sql.end(); } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

**Step 2: Test manually with curl**

```bash
curl -s -X POST 'https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/doug-resolution-checker' \
  -H 'Authorization: Bearer {ANON_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expected: `{"ok":true,"pending":N,"resolved":M,"errors":0}`

**Step 3: Verify resolutions**

```sql
SELECT condition_id, title, outcome, winning_outcome, resolution_pnl, market_closed
FROM profile_tracker.pt_trades_doug
WHERE market_closed = true
LIMIT 10;
-- Should show resolved trades with PnL calculated
```

---

## Task 4: Create pg_cron jobs

**Step 1: Trade copier — every minute**

```sql
SELECT cron.schedule(
  'doug-trade-copier-every-minute',
  '* * * * *',
  $$ SELECT net.http_post(
    url := 'https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/doug-trade-copier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {ANON_KEY}'
    ),
    body := '{}'::jsonb
  ) AS request_id; $$
);
```

**Step 2: Resolution checker — every 30 minutes**

```sql
SELECT cron.schedule(
  'doug-resolution-checker-every-30min',
  '*/30 * * * *',
  $$ SELECT net.http_post(
    url := 'https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/doug-resolution-checker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer {ANON_KEY}'
    ),
    body := '{}'::jsonb
  ) AS request_id; $$
);
```

**Step 3: Verify**

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'doug%';
-- Expect 2 rows, both active
```

---

## Task 5: Update frontend — types + data layer

**Files to modify:**
- `lib/types.ts` — add DougTrade type
- `lib/supabase.ts` — add fetch functions for Doug's tables

**Step 1: Add DougTrade type to `lib/types.ts`**

```typescript
export interface DougTrade {
  id: number;
  condition_id: string;
  source_table: string;
  title: string;
  slug: string | null;
  outcome: string | null;
  side: string | null;
  icon_url: string | null;
  source_usdc_size: number;
  flat_size: number;
  entry_price: number | null;
  shares: number | null;
  market_closed: boolean;
  winning_outcome: string | null;
  resolution_pnl: number | null;
  resolved_at: string | null;
  event_timestamp: string | null;
  copied_at: string;
  last_checked_at: string | null;
}
```

**Step 2: Add fetch functions to `lib/supabase.ts`**

```typescript
export async function fetchDougSnapshots(limit = 1440) {
  const { data, error } = await getSupabaseClient()
    .from('pt_doug_snapshots_view')
    .select('*')
    .order('captured_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Snapshot[];
}

export async function fetchDougTrades(limit = 200) {
  const { data, error } = await getSupabaseClient()
    .from('pt_trades_doug_view')
    .select('*')
    .order('copied_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DougTrade[];
}
```

---

## Task 6: Update frontend — Dashboard + components

**Files to modify:**
- `components/Dashboard.tsx` — switch to Doug data sources
- `components/PnLHero.tsx` — change INITIAL_INVESTMENT to 42
- `components/ActivityFeed.tsx` — adapt for DougTrade type (show resolution status, source badge)
- `app/page.tsx` — switch from MaintenancePage back to Dashboard

**Step 1: Update `components/Dashboard.tsx`**

Replace `fetchSnapshots`/`fetchActivity` with `fetchDougSnapshots`/`fetchDougTrades`. Change state type from `Activity[]` to `DougTrade[]`. Update header title. Pass DougTrade[] to ActivityFeed.

**Step 2: Update `components/PnLHero.tsx`**

Change `INITIAL_INVESTMENT = 17_000` to `INITIAL_INVESTMENT = 42`.

**Step 3: Update `components/ActivityFeed.tsx`**

Accept `DougTrade[]` instead of `Activity[]`. For each trade, show:
- Same icon/title/link layout as before
- BUY chip + outcome chip (Yes/No) + entry price chip
- Source badge: "f705", "cc50", "571c", or "80cd" (small gray chip)
- Flat size: "$20.00" (right-aligned)
- Resolution status:
  - Pending: yellow "PENDING" chip
  - Won: green "WON +$6.67" chip (shows resolution_pnl)
  - Lost: red "LOST -$20.00" chip (shows resolution_pnl)

**Step 4: Update `app/page.tsx`**

Switch from `MaintenancePage` to `Dashboard`:
```typescript
import Dashboard from '@/components/Dashboard';
export default function Home() { return <Dashboard />; }
```

**Step 5: Verify locally**

```bash
npm run dev
# Open http://localhost:3000
# Should show Doug's paper trades with resolution status
# PnL chart should show balance history starting at $42
```

---

## Task 7: Deploy to Vercel + end-to-end verification

**Step 1: Build check**

```bash
npm run build
```

**Step 2: Deploy**

Push to main or use Vercel CLI. Verify at `polymarket-tracker-roan.vercel.app`.

**Step 3: Verify cron jobs running**

```sql
-- Trade copier running every minute
SELECT status, start_time FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'doug-trade-copier-every-minute')
ORDER BY start_time DESC LIMIT 5;

-- Resolution checker running every 30 min
SELECT status, start_time FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'doug-resolution-checker-every-30min')
ORDER BY start_time DESC LIMIT 5;
```

**Step 4: Verify data flow**

```sql
-- Doug trades being copied
SELECT COUNT(*), source_table FROM profile_tracker.pt_trades_doug GROUP BY source_table;

-- Resolutions happening
SELECT market_closed, COUNT(*) FROM profile_tracker.pt_trades_doug GROUP BY market_closed;

-- Snapshots accumulating
SELECT COUNT(*) FROM profile_tracker.pt_doug_snapshots;
```

---

## Task 8: Update CLAUDE.md

Document all new infrastructure:
- pt_trades_doug / pt_trades_vincent / pt_trades_juju tables + schema
- pt_doug_snapshots table
- doug-trade-copier edge function + cron job
- doug-resolution-checker edge function + cron job
- Paper trading formula (flat $20, shares = 20/price)
- Resolution API: CLOB API at clob.polymarket.com/markets/{condition_id}
- Dashboard now shows Doug's data, INITIAL_INVESTMENT = $42

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Only copy BUY trades | SELL = exits, MERGE = redemptions. Only BUYs are new predictions. |
| $20 flat per trade | User specified. No position sizing relative to source trader's size. |
| Copy once per condition_id | Deduplicate across all 4 source profiles. First source wins. |
| CLOB API for resolution | Direct condition_id lookup. Returns `tokens[].winner` boolean. |
| 1-min snapshots via trade copier | Gives same chart granularity as existing dashboard. |
| Balance = initial + realized_pnl - pending_cost | Pending trades lock up $20 each until resolved. |
| No balance limit enforcement | Paper trading — balance can go negative. |
