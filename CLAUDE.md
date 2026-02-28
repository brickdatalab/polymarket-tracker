# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Serve production build
npm run lint     # ESLint via Next.js
```

No test runner is configured.

## Environment Variables

Requires `.env.local` with:
- `NEXT_PUBLIC_SUPABASE_URL` — points to Supabase project `poly` (`cxvntzszdkyggjjenefn`, us-east-2)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## What This Is

A **paper-trading tracker** ("Doug") that copy-trades predictions from 4 Polymarket profiles, matching the source profile's wager amount capped at $100. Starting balance: $17,544.83. Historical P&L seeded from summary.csv (Jan 19 – Feb 28 2026, 41 daily snapshots). Also retains the original @0x8dxd proportional stake tracker in the background data pipeline.

## Current State (as of Feb 28 2026)

- **Dashboard is LIVE** at `polymarket-tracker-roan.vercel.app`
- **793 trades** copied with matched sizing ($0.03–$100, avg $48.49)
- **694 resolved**, **~99 pending** (resolution checker runs every 30 min)
- **Current Balance**: ~$51,196 | **Net P&L**: ~$33,651 | **Starting**: $17,544.83
- **Snapshots**: 41 historical daily (Jan 19–Feb 28) + minute-level going forward
- All 4 cron jobs running normally (activity sync, trade copier, resolution checker)
- Edge functions: `multi-profile-activity-sync` (v1), `doug-trade-copier` (v3), `doug-resolution-checker` (v1)

### How P&L Updates Flow

```
1. Resolution checker (*/30 min) detects closed market via CLOB API
   → writes resolution_pnl to pt_trades_doug
2. Trade copier (* min) reads SUM(resolution_pnl)
   → tracker_value = 51098.17 + resolved_pnl
   → inserts new snapshot into pt_doug_snapshots
3. Frontend polls (every 60s)
   → fetches latest snapshot
   → PnLHero displays updated Net P&L and Current Balance
```

Max lag from resolution to display: ~32 minutes (30 min checker + 1 min copier + 1 min poll).

### What's NOT Done / Future Work

- `pt_trades_vincent` and `pt_trades_juju` tables exist but have no copier edge functions
- No alerting if edge functions error out silently
- `MaintenancePage.tsx` still exists in repo (unused, can be deleted)
- `docs/` and `preview-maintenance.html` are untracked leftover files (can be deleted)
- Resolution checker processes all pending trades sequentially — could be slow if hundreds accumulate (but handles 793 in one pass today)

## Full System Architecture

The dashboard (this repo) and the data pipeline (Supabase edge functions) are fully decoupled — they share only the database.

```
Polymarket Data API                    Polymarket CLOB API
  └── /activity?user=...&limit=200       └── /markets/{condition_id}
        │                                       │
        │  every 60s (4 profiles)               │  every 30min (unresolved markets)
        ▼                                       ▼
Edge Function: multi-profile-activity-sync   Edge Function: doug-resolution-checker
  → UPSERTs into pt_activity_{f705,cc50,     → Checks market_closed + winner
    571c,80cd} (TRADE+MERGE only)              → Updates resolution_pnl in pt_trades_doug
        │                                       │
        ▼                                       │
Edge Function: doug-trade-copier ◄──────────────┘
  → Copies new BUY trades from 4 source
    tables → pt_trades_doug (matched wager, max $100)
  → Inserts snapshot into pt_doug_snapshots
        │
        │  direct Postgres writes
        ▼
Supabase Postgres — schema: profile_tracker
  ├── pt_config          (1 row)    — original @0x8dxd config
  ├── pt_snapshots       (6,600+)   — original P&L time-series
  ├── pt_activity        (1,900+)   — @0x8dxd positions
  ├── pt_activity_f705   (203+)     — source profile 1
  ├── pt_activity_cc50   (483+)     — source profile 2 (justdance)
  ├── pt_activity_571c   (82+)      — source profile 3 (dustedfloor)
  ├── pt_activity_80cd   (170+)     — source profile 4
  ├── pt_trades_doug     (793+)     — Doug paper trades (active)
  ├── pt_trades_vincent  (0)        — Vincent paper trades (inactive)
  ├── pt_trades_juju     (0)        — Juju paper trades (inactive)
  └── pt_doug_snapshots  (growing)  — Doug P&L time-series
        │
        │  exposed via public schema views (RLS: SELECT-only for anon)
        ▼
Public Views (read by supabase-js in browser)
  ├── pt_trades_doug_view        ← Dashboard reads these
  ├── pt_doug_snapshots_view     ← Dashboard reads these
  ├── pt_snapshots_view          (legacy)
  ├── pt_activity_view           (legacy)
  └── pt_activity_{f705,cc50,571c,80cd}_view
        │
        ▼
Next.js 14 Dashboard (this repo, deployed on Vercel)
  Dashboard.tsx → polls every 60s + on tab focus
  ├── PnLHero      — Net P&L, %, Starting Balance ($17,544.83), Current Balance
  │                  (period-aware: changes with time range selection)
  ├── PnLChart     — Recharts line chart with time range tabs (All/1M/1W/1D)
  │                  (deduped by day for All/1M/1W; raw minute-level for 1D)
  └── ActivityFeed — Doug trades with outcome + resolution chips (no source badges)
```

### Doug Paper Trading P&L Formula

```
STARTING_BALANCE = 17544.83
BASE_BALANCE     = 51098.17  (balance as of Feb 28 2026, after historical seeding)
MAX_WAGER        = 100       (cap on matched wager)
flat_size        = min(source_usdc_size, 100)  (match source, capped)

shares         = flat_size / entry_price         (e.g. $50 / $0.50 = 100 shares)
resolution_pnl = won ? (shares * 1.0) - flat_size : -flat_size
                 (won: shares pay $1 each; lost: $0 payout)
tracker_value  = BASE_BALANCE + SUM(resolution_pnl WHERE resolved)
tracker_pnl    = tracker_value - STARTING_BALANCE
```

### Original @0x8dxd P&L Formula (background pipeline)

```
tracker_value = initial_tracker_value + stake_pct × (current_portfolio_value - value_at_launch)
tracker_pnl   = tracker_value - initial_investment
```

### Supabase Backend

- **Project**: `poly` (ID: `cxvntzszdkyggjjenefn`, region: us-east-2)
- **Schema**: `profile_tracker` — 11 tables, no triggers
- **RLS**: All tables have permissive SELECT for `public` role. No write policies — edge functions write via direct Postgres connection.
- **Cron jobs**:
  - `profile-tracker-sync-every-minute` (job 92, `* * * * *`) — syncs main profile (@0x8dxd) snapshots + activity
  - `multi-profile-activity-sync-every-minute` (job 121, `* * * * *`) — syncs 4 source profile activity tables
  - `doug-trade-copier-every-minute` (job 122, `* * * * *`) — copies new BUY trades from source tables to pt_trades_doug + inserts snapshot
  - `doug-resolution-checker-every-30min` (job 123, `*/30 * * * *`) — checks unresolved markets via CLOB API, updates resolution_pnl
- **Edge functions**:
  - `profile-tracker-sync` (Deno, v2) — main profile P&L snapshots + activity sync
  - `multi-profile-activity-sync` (Deno, verify_jwt=false) — syncs activity for f705/cc50/571c/80cd. Fetches limit=200 per wallet, filters TRADE+MERGE, UPSERTs via `sql.unsafe()`
  - `doug-trade-copier` (Deno, v3, verify_jwt=false) — copies BUY trades from 4 source tables into pt_trades_doug. Matches source profile's wager amount capped at $100 (`flat_size = min(source_usdc_size, 100)`). Balance = BASE_BALANCE (51098.17) + resolved_pnl. Inserts P&L snapshot each run.
  - `doug-resolution-checker` (Deno, v1, verify_jwt=false) — fetches `https://clob.polymarket.com/markets/{condition_id}` for unresolved trades. If `closed=true`, reads `tokens[].winner` to determine outcome. Updates `market_closed`, `winning_outcome`, `resolution_pnl`, `resolved_at`.
- **Config row**: wallet `0x63ce...9ba9a`, stake 2.524884%, initial investment $17,000, launch Feb 23 2026
- **Doug config**: matches source wager capped at $100, $17,544.83 starting balance, $51,098.17 base balance forward, copies from all 4 source profiles (BUY side only)
- **Historical snapshots**: 41 daily data points seeded from summary.csv (Jan 19 – Feb 28 2026)

### Additional Profile Activity Tables

Four additional activity tables track other Polymarket profiles. They share the same schema as `pt_activity` (keyed by `condition_id`, one row per unique market position) and are synced every 60s by the `multi-profile-activity-sync` edge function.

| Table | Wallet | Username | Rows | Notes |
|-------|--------|----------|------|-------|
| `pt_activity_f705` | `0xf705fa045201391d9632b7f3cde06a5e24453ca7` | (anonymous) | 203 | BTC/ETH/SOL/XRP/DOGE price predictions |
| `pt_activity_cc50` | `0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82` | justdance | 483 | BTC/ETH short-interval up/down markets |
| `pt_activity_571c` | `0x571c285a83eba5322b5f916ba681669dc368a61f` | dustedfloor | 82 | BTC/ETH 5-min up/down (concentrated) |
| `pt_activity_80cd` | `0x80cd8310aa624521e9e1b2b53b568cafb0ef0273` | (anonymous) | 170 | SOL-focused price predictions |

- **Schema**: identical to `pt_activity` plus `type` column — columns: `id`, `condition_id` (UNIQUE), `title`, `slug`, `outcome`, `side`, `icon_url`, `usdc_size`, `tracker_size`, `price`, `event_timestamp`, `type`, `first_seen_at`, `last_updated_at`
- **`type` column**: stores API activity type — only `TRADE` and `MERGE` are synced (REDEEM and CONVERSION are excluded)
- **`tracker_size`**: NULL in all rows (stake percentages not yet defined)
- **RLS**: permissive SELECT for `public` role on each table
- **Views**: `pt_activity_{id}_view` in `public` schema (SELECT * from each table)
- **Indexes**: DESC index on `event_timestamp` per table
- **Data source**: full backfill from `https://data-api.polymarket.com/activity?user={wallet}` (4 pages × 1000 records, deduplicated by `conditionId`), kept live by `multi-profile-activity-sync` cron job
- **Sync**: `multi-profile-activity-sync` edge function fetches limit=200 per wallet every 60s, filters TRADE+MERGE, UPSERTs by condition_id

### Doug Paper Trading Tables

| Table | Purpose | Rows | Status |
|-------|---------|------|--------|
| `pt_trades_doug` | Paper trades copied from all 4 source profiles | 793+ | Active — synced every minute |
| `pt_trades_vincent` | Reserved for Vincent paper trades | 0 | Inactive — table created, no copier |
| `pt_trades_juju` | Reserved for Juju paper trades | 0 | Inactive — table created, no copier |
| `pt_doug_snapshots` | Doug P&L time-series (41 daily + minute-level) | growing | Active — written by trade copier |

- **Trade table schema** (`pt_trades_doug`): `id`, `condition_id` (UNIQUE), `source_table`, `title`, `slug`, `outcome`, `side`, `icon_url`, `source_usdc_size`, `flat_size` (min of source_usdc_size, $100), `entry_price`, `shares`, `market_closed`, `winning_outcome`, `resolution_pnl`, `resolved_at`, `event_timestamp`, `copied_at`, `last_checked_at`
- **Snapshot schema** (`pt_doug_snapshots`): `id`, `captured_at`, `profile_value`, `tracker_value`, `tracker_pnl` — matches `Snapshot` TypeScript interface
- **Resolution API**: Polymarket CLOB API at `https://clob.polymarket.com/markets/{condition_id}` — returns `closed` boolean and `tokens[].winner` boolean
- **Views**: `pt_trades_doug_view`, `pt_doug_snapshots_view`, `pt_trades_vincent_view`, `pt_trades_juju_view` in `public` schema
- **Indexes**: DESC index on `copied_at` for pt_trades_doug; DESC on `captured_at` for pt_doug_snapshots

### Vercel Deployment

- **Project**: `polymarket-tracker` (ID: `prj_57IkM3ttUzLn1ykTrNZPRavLAIFX`)
- **Team**: Vincent Vitolo's projects (`team_DOlvEbGzGy6jyR0esnm85krZ`)
- **Production URL**: `polymarket-tracker-roan.vercel.app`
- **Framework**: Next.js, Node 24.x

## Frontend Details

- **No server-side data fetching** — `app/page.tsx` is a static shell; `Dashboard` is `'use client'` and owns all state.
- **Supabase reads only** — the app reads from `pt_doug_snapshots_view` and `pt_trades_doug_view`. No writes, no auth.
- **Types** are in `lib/types.ts`: `Snapshot` (time-series P&L), `DougTrade` (paper trades with resolution), `Activity` (legacy), `TrackerState`.
- **Data fetching** in `lib/supabase.ts`: `fetchDougSnapshots()` and `fetchDougTrades()` — cast to `Snapshot[]` and `DougTrade[]`.
- **Dashboard title**: `doug_tracker`
- **PnLHero**: Shows Net P&L (large, color-coded), % Return, Starting Balance ($17,544.83), Current Balance. `INITIAL_INVESTMENT = 17_544.83`. P&L is period-aware — computed as `latest.tracker_pnl - first.tracker_pnl` from filtered snapshots, so it changes when time range tabs are clicked.
- **PnLChart**: Time range tabs (All/1M/1W/1D) filter snapshots before rendering. All/1M/1W deduplicate by day (one point per day). 1D shows raw minute-level snapshots for intraday visibility. Historical data from Jan 19 shows full journey.
- **ActivityFeed**: Shows outcome chip (YES/NO), resolution chip (PENDING/WON/LOST with amounts), matched wager amount (up to $100), relative timestamp. No source badges or entry prices.
- **Styling**: Tailwind CSS with dark theme (zinc palette). CSS variables for `--bg`, `--card`, `--border` in `globals.css`. Mobile-optimized with 17px base font and 44px touch targets on small screens.
- **Images**: `next.config.mjs` allows remote images from `polymarket-upload.s3.us-east-2.amazonaws.com`, `images.ctfassets.net`, `*.polymarket.com`.
- **Constants**: `INITIAL_INVESTMENT = 17_544.83` in PnLHero, `POLL_MS = 60_000` in Dashboard.
- **Path alias**: `@/*` maps to project root.

## Key Operational Notes

- **After truncating `pt_trades_doug`**: The trade copier cron re-copies all trades from source tables within 1 minute. You must also manually invoke the resolution checker (`curl https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/doug-resolution-checker`) to re-resolve trades, otherwise they all show as PENDING.
- **After deploying a new trade copier**: Truncate trades, wait for re-copy, then invoke resolution checker.
- **Historical snapshots**: The 41 daily snapshots from summary.csv are the foundation of the "All" chart view. New minute-level snapshots accumulate on top. The deduplication logic ensures only one point per day for the long-range views.
- **BASE_BALANCE (51098.17)** is hardcoded in the edge function — it represents the account value as of the last historical data point (Feb 28 2026). All future P&L is relative to this anchor.
