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
    tables → pt_trades_doug ($20/$30 by event)
  → Skips 3rd+ trade per event slug
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
  ├── pt_trades_doug     (749+)     — Doug paper trades (active)
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
  ├── PnLHero      — $PnL, %, Starting Balance ($17,544.83), Current Balance
  ├── PnLChart     — Recharts line chart with time range tabs (All/1M/1W/1D)
  └── ActivityFeed — Doug trades with outcome + resolution chips (no source badges)
```

### Doug Paper Trading P&L Formula

```
STARTING_BALANCE = 17544.83
BASE_BALANCE     = 51098.17  (balance as of Feb 28 2026, after historical seeding)
MAX_WAGER        = 100       (cap on matched wager)
flat_size        = min(source_usdc_size, 100)  (match source, capped)

shares         = flat_size / entry_price         (e.g. $20 / $0.50 = 40 shares)
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
  - `doug-resolution-checker` (Deno, verify_jwt=false) — fetches `https://clob.polymarket.com/markets/{condition_id}` for unresolved trades. If `closed=true`, reads `tokens[].winner` to determine outcome. Updates `market_closed`, `winning_outcome`, `resolution_pnl`, `resolved_at`.
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
| `pt_trades_doug` | Paper trades copied from all 4 source profiles | 780+ | Active — synced every minute |
| `pt_trades_vincent` | Reserved for Vincent paper trades | 0 | Inactive — table created, no copier |
| `pt_trades_juju` | Reserved for Juju paper trades | 0 | Inactive — table created, no copier |
| `pt_doug_snapshots` | Doug P&L time-series (one row per minute) | growing | Active — written by trade copier |

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
- **PnLHero**: Shows Net P&L (large, color-coded), % Return, Starting Balance ($17,544.83), Current Balance. `INITIAL_INVESTMENT = 17_544.83`.
- **PnLChart**: Time range tabs (All/1M/1W/1D) filter snapshots before rendering. Historical data from Jan 19 shows full journey.
- **ActivityFeed**: Shows outcome chip (YES/NO), resolution chip (PENDING/WON/LOST with amounts), matched wager amount (up to $100), relative timestamp. No source badges or entry prices.
- **Styling**: Tailwind CSS with dark theme (zinc palette). CSS variables for `--bg`, `--card`, `--border` in `globals.css`. Mobile-optimized with 17px base font and 44px touch targets on small screens.
- **Images**: `next.config.mjs` allows remote images from `polymarket-upload.s3.us-east-2.amazonaws.com`, `images.ctfassets.net`, `*.polymarket.com`.
- **Constants**: `INITIAL_INVESTMENT = 17_544.83` in PnLHero, `POLL_MS = 60_000` in Dashboard.
- **Path alias**: `@/*` maps to project root.
