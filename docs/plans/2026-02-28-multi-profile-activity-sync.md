# Multi-Profile Activity Backfill + Live Sync

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fully backfill 4 profile activity tables (4000 records each, filtered to TRADE/MERGE only), add a `type` column, then deploy an always-on edge function + pg_cron job so new activities appear within 60 seconds.

**Architecture:** A new Supabase edge function `multi-profile-activity-sync` runs every 60s via pg_cron. It loops over 4 wallet→table mappings, fetches the latest 200 activities from Polymarket's `/activity` API, filters to allowed types (TRADE, MERGE), deduplicates by `conditionId`, and UPSERTs into each profile's table. This is separate from the existing `profile-tracker-sync` (which handles P&L snapshots + activity for the original `@0x8dxd` wallet).

**Tech Stack:** Supabase Edge Functions (Deno), pg_cron, Polymarket Data API, Postgres

---

## Context for the Implementer

### Supabase Project
- **Project ID**: `cxvntzszdkyggjjenefn`
- **Region**: us-east-2
- **Schema**: `profile_tracker`

### Wallet → Table Mapping

| Short ID | Wallet | Table | View |
|----------|--------|-------|------|
| `f705` | `0xf705fa045201391d9632b7f3cde06a5e24453ca7` | `profile_tracker.pt_activity_f705` | `pt_activity_f705_view` |
| `cc50` | `0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82` | `profile_tracker.pt_activity_cc50` | `pt_activity_cc50_view` |
| `571c` | `0x571c285a83eba5322b5f916ba681669dc368a61f` | `profile_tracker.pt_activity_571c` | `pt_activity_571c_view` |
| `80cd` | `0x80cd8310aa624521e9e1b2b53b568cafb0ef0273` | `profile_tracker.pt_activity_80cd` | `pt_activity_80cd_view` |

### Polymarket `/activity` API

- **Endpoint**: `https://data-api.polymarket.com/activity?user={wallet}&limit={limit}&offset={offset}`
- **Max per request**: `limit=1000`
- **Max offset**: `3000` (so 4 pages max: offsets 0, 1000, 2000, 3000 = 4000 raw records)
- **Response**: JSON array of activity objects
- **Activity types seen**: `TRADE`, `MERGE`, `REDEEM`, `CONVERSION`
- **We keep**: `TRADE`, `MERGE` (TRADE covers both BUY and SELL via the `side` field)
- **We exclude**: `REDEEM` (market settlements), `CONVERSION` (rare, only 3 records ever seen — essentially a variant of redeem)

### API Record Shape

```json
{
  "proxyWallet": "0x...",
  "timestamp": 1772286687,
  "conditionId": "0x...",
  "type": "TRADE",
  "size": 111,
  "usdcSize": 6.877,
  "transactionHash": "0x...",
  "price": 0.062,
  "asset": "86420...",
  "side": "SELL",
  "outcomeIndex": 1,
  "title": "Will the price of Bitcoin be above $76,000 on March 6?",
  "slug": "bitcoin-above-76k-on-march-6",
  "icon": "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png",
  "eventSlug": "bitcoin-above-on-march-6",
  "outcome": "No",
  "name": "", "pseudonym": "", "bio": "", "profileImage": "", "profileImageOptimized": ""
}
```

For MERGE type: `side=""`, `outcome=""`, `price=0`, `outcomeIndex=999`.

### Existing Edge Function Reference

The existing `profile-tracker-sync` edge function (file: `index.ts`) handles the original wallet. Read it at:
```
mcp__claude_ai_Supabase__get_edge_function(project_id="cxvntzszdkyggjjenefn", function_slug="profile-tracker-sync")
```

It connects via `postgres` npm package with `SUPABASE_DB_URL` env var. Same pattern should be used for the new function.

### Type Distribution (across all 4000 raw records per wallet)

| Profile | TRADE | MERGE | REDEEM | CONVERSION |
|---------|-------|-------|--------|------------|
| f705 | 3826 | 48 | 126 | 0 |
| cc50 | 3638 | 88 | 274 | 0 |
| 571c | 3902 | 18 | 80 | 0 |
| 80cd | 3678 | 227 | 92 | 3 |

### Current Table State

Tables exist with data from initial 500-record backfill (no `type` column yet):
- f705: 83 rows, cc50: 76 rows, 571c: 14 rows, 80cd: 55 rows

---

## Task 1: Add `type` Column to All 4 Tables

**Purpose:** Store the activity type (TRADE/MERGE) so we can filter and display appropriately.

**Tool:** `mcp__claude_ai_Supabase__apply_migration`

**Step 1: Apply migration**

```sql
-- Add type column to all 4 profile activity tables
ALTER TABLE profile_tracker.pt_activity_f705 ADD COLUMN type text;
ALTER TABLE profile_tracker.pt_activity_cc50 ADD COLUMN type text;
ALTER TABLE profile_tracker.pt_activity_571c ADD COLUMN type text;
ALTER TABLE profile_tracker.pt_activity_80cd ADD COLUMN type text;

-- Recreate views to include new column
CREATE OR REPLACE VIEW public.pt_activity_f705_view AS SELECT * FROM profile_tracker.pt_activity_f705;
CREATE OR REPLACE VIEW public.pt_activity_cc50_view AS SELECT * FROM profile_tracker.pt_activity_cc50;
CREATE OR REPLACE VIEW public.pt_activity_571c_view AS SELECT * FROM profile_tracker.pt_activity_571c;
CREATE OR REPLACE VIEW public.pt_activity_80cd_view AS SELECT * FROM profile_tracker.pt_activity_80cd;
```

Migration name: `add_type_column_to_profile_activity_tables`

**Step 2: Verify**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'profile_tracker' AND table_name = 'pt_activity_f705' AND column_name = 'type';
```

Expected: 1 row returned.

---

## Task 2: Full Backfill — All 4 Wallets, 4000 Records Each, Filtered

**Purpose:** Replace the partial 500-record backfill with the full 4000-record backfill, filtered to TRADE and MERGE only.

**Approach:** For each wallet, launch a parallel sub-agent that:
1. Truncates the existing table (clean slate — old data is subset of new)
2. Fetches all 4 pages (offsets 0, 1000, 2000, 3000) from the API
3. Filters to `type === 'TRADE' || type === 'MERGE'`
4. Deduplicates by `conditionId` (keep first occurrence = chronologically latest)
5. Batch INSERTs via `mcp__claude_ai_Supabase__execute_sql`
6. Reports row count

**Step 1: Launch 4 parallel sub-agents**

Each sub-agent receives this instruction template (substitute wallet, table name, short ID):

```
You need to fully backfill Supabase table `profile_tracker.pt_activity_{SHORT_ID}`
in project `cxvntzszdkyggjjenefn`.

1. TRUNCATE the table first:
   Execute SQL: `TRUNCATE profile_tracker.pt_activity_{SHORT_ID} RESTART IDENTITY;`

2. For each offset in [0, 1000, 2000, 3000]:
   - Fetch: https://data-api.polymarket.com/activity?user={WALLET}&limit=1000&offset={offset}
   - Parse the JSON array

3. Combine all records (up to 4000), then:
   - Filter: keep only records where type is "TRADE" or "MERGE"
   - Deduplicate by conditionId (keep first occurrence = latest)

4. Build INSERT SQL in batches of 100 rows:
   INSERT INTO profile_tracker.pt_activity_{SHORT_ID}
     (condition_id, title, slug, outcome, side, icon_url, usdc_size, price, type, event_timestamp)
   VALUES (...)
   ON CONFLICT (condition_id) DO UPDATE SET
     title = EXCLUDED.title,
     slug = EXCLUDED.slug,
     outcome = EXCLUDED.outcome,
     side = EXCLUDED.side,
     icon_url = EXCLUDED.icon_url,
     usdc_size = EXCLUDED.usdc_size,
     price = EXCLUDED.price,
     type = EXCLUDED.type,
     event_timestamp = EXCLUDED.event_timestamp,
     last_updated_at = now();

5. Execute via mcp__claude_ai_Supabase__execute_sql (project_id: cxvntzszdkyggjjenefn)

6. Verify: SELECT COUNT(*), COUNT(DISTINCT type) FROM profile_tracker.pt_activity_{SHORT_ID};

IMPORTANT:
- tracker_size = NULL (omit from INSERT)
- Escape single quotes: ' → ''
- timestamp is Unix seconds → convert: to_timestamp({timestamp})
- Use ToolSearch to load mcp__claude_ai_Supabase__execute_sql first
```

**Step 2: Verify all 4 tables**

```sql
SELECT 'f705' AS p, COUNT(*) AS rows, COUNT(DISTINCT type) AS types FROM profile_tracker.pt_activity_f705
UNION ALL SELECT 'cc50', COUNT(*), COUNT(DISTINCT type) FROM profile_tracker.pt_activity_cc50
UNION ALL SELECT '571c', COUNT(*), COUNT(DISTINCT type) FROM profile_tracker.pt_activity_571c
UNION ALL SELECT '80cd', COUNT(*), COUNT(DISTINCT type) FROM profile_tracker.pt_activity_80cd;
```

Expected: row counts significantly higher than before (83→~150+, 76→~400+, 14→~70+, 55→~130+), each with 1-2 types.

**Step 3: Spot-check sample rows**

```sql
SELECT type, title, side, outcome, price, event_timestamp
FROM profile_tracker.pt_activity_f705
ORDER BY event_timestamp DESC LIMIT 5;
```

Verify: no REDEEM rows (those would have side='', outcome='', price=0).

---

## Task 3: Create Edge Function `multi-profile-activity-sync`

**Purpose:** Always-on sync that fetches new activities for all 4 profiles every 60 seconds.

**Step 1: Write the edge function**

Create edge function `multi-profile-activity-sync` with this code:

```typescript
import postgres from 'npm:postgres';

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';

// Wallet → table mapping
const PROFILES = [
  { wallet: '0xf705fa045201391d9632b7f3cde06a5e24453ca7', table: 'pt_activity_f705' },
  { wallet: '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82', table: 'pt_activity_cc50' },
  { wallet: '0x571c285a83eba5322b5f916ba681669dc368a61f', table: 'pt_activity_571c' },
  { wallet: '0x80cd8310aa624521e9e1b2b53b568cafb0ef0273', table: 'pt_activity_80cd' },
];

// Only keep these activity types
const ALLOWED_TYPES = new Set(['TRADE', 'MERGE']);

Deno.serve(async (_req: Request) => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
    prepare: false,
    ssl: 'require',
  });

  const results: Record<string, { upserted: number; error?: string }> = {};

  try {
    for (const { wallet, table } of PROFILES) {
      try {
        // Fetch latest 200 activities (same cadence as existing sync)
        const res = await fetch(
          `${POLYMARKET_DATA_API}/activity?user=${wallet}&limit=200`
        );
        if (!res.ok) {
          results[table] = { upserted: 0, error: `API ${res.status}` };
          continue;
        }

        const activities = (await res.json()) as Array<{
          conditionId: string;
          title: string;
          slug?: string;
          outcome?: string;
          side?: string;
          icon?: string;
          usdcSize: number;
          price?: number;
          timestamp: number;
          type?: string;
        }>;

        if (!Array.isArray(activities) || activities.length === 0) {
          results[table] = { upserted: 0 };
          continue;
        }

        // Filter to allowed types only
        const filtered = activities.filter(
          (a) => a.type && ALLOWED_TYPES.has(a.type)
        );

        // Deduplicate by conditionId (keep first = chronologically latest)
        const seen = new Set<string>();
        const unique = filtered.filter((a) => {
          if (!a.conditionId || seen.has(a.conditionId)) return false;
          seen.add(a.conditionId);
          return true;
        });

        // Upsert each unique activity
        for (const act of unique) {
          const evtTs = new Date(act.timestamp * 1000).toISOString();

          await sql`
            INSERT INTO profile_tracker.${sql(table)}
              (condition_id, title, slug, outcome, side, icon_url, usdc_size, price, type, event_timestamp, last_updated_at)
            VALUES
              (${act.conditionId}, ${act.title}, ${act.slug ?? null}, ${act.outcome ?? null},
               ${act.side ?? null}, ${act.icon ?? null}, ${act.usdcSize}, ${act.price ?? null},
               ${act.type ?? null}, ${evtTs}, now())
            ON CONFLICT (condition_id)
            DO UPDATE SET
              title           = EXCLUDED.title,
              slug            = EXCLUDED.slug,
              outcome         = EXCLUDED.outcome,
              side            = EXCLUDED.side,
              icon_url        = EXCLUDED.icon_url,
              usdc_size       = EXCLUDED.usdc_size,
              price           = EXCLUDED.price,
              type            = EXCLUDED.type,
              event_timestamp = EXCLUDED.event_timestamp,
              last_updated_at = now()
          `;
        }

        results[table] = { upserted: unique.length };
      } catch (profileErr) {
        results[table] = { upserted: 0, error: String(profileErr) };
      }
    }

    await sql.end();

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('multi-profile-activity-sync error:', err);
    try { await sql.end(); } catch { /* ignore */ }
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

**IMPORTANT NOTE on dynamic table names:** The `postgres` npm package's tagged template `sql()` helper for identifiers may or may not work for schema-qualified dynamic table names. If `${sql(table)}` doesn't work for the table identifier, the alternative is to use 4 separate hardcoded upsert blocks (one per profile) or use `sql.unsafe()` for the table name portion. Test this during deployment. A safe fallback:

```typescript
await sql.unsafe(`
  INSERT INTO profile_tracker.${table}
    (condition_id, title, slug, outcome, side, icon_url, usdc_size, price, type, event_timestamp, last_updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
  ON CONFLICT (condition_id)
  DO UPDATE SET
    title=EXCLUDED.title, slug=EXCLUDED.slug, outcome=EXCLUDED.outcome,
    side=EXCLUDED.side, icon_url=EXCLUDED.icon_url, usdc_size=EXCLUDED.usdc_size,
    price=EXCLUDED.price, type=EXCLUDED.type, event_timestamp=EXCLUDED.event_timestamp,
    last_updated_at=now()
`, [act.conditionId, act.title, act.slug??null, act.outcome??null,
    act.side??null, act.icon??null, act.usdcSize, act.price??null,
    act.type??null, evtTs]);
```

**Step 2: Deploy**

```
mcp__claude_ai_Supabase__deploy_edge_function(
  project_id="cxvntzszdkyggjjenefn",
  function_slug="multi-profile-activity-sync",
  ...
)
```

Set `verify_jwt: false` (same as existing function — called by pg_cron, not users).

**Step 3: Test manually**

Invoke the function directly to confirm it works:
```bash
curl -X POST https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/multi-profile-activity-sync \
  -H "Authorization: Bearer {ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response: `{"ok":true,"results":{"pt_activity_f705":{"upserted":N},...}}`

---

## Task 4: Create pg_cron Job

**Purpose:** Call the edge function every 60 seconds (fastest pg_cron supports).

**Step 1: Create the cron job**

```sql
SELECT cron.schedule(
  'multi-profile-activity-sync-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://cxvntzszdkyggjjenefn.supabase.co/functions/v1/multi-profile-activity-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4dm50enN6ZGt5Z2dqamVuZWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MDg5NDcsImV4cCI6MjA4Mzk4NDk0N30.BsPzfyVzeLTtW7vfee9ZzuJrP4YTumQ8UFOJG3gyavo'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
```

Execute via `mcp__claude_ai_Supabase__execute_sql`.

**Step 2: Verify cron job is active**

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE '%multi%';
```

Expected: 1 row, active=true, schedule='* * * * *'.

---

## Task 5: End-to-End Verification

**Step 1: Wait ~2 minutes for 2 cron cycles**

**Step 2: Check `last_updated_at` is recent**

```sql
SELECT 'f705' AS p, MAX(last_updated_at) AS last_sync FROM profile_tracker.pt_activity_f705
UNION ALL SELECT 'cc50', MAX(last_updated_at) FROM profile_tracker.pt_activity_cc50
UNION ALL SELECT '571c', MAX(last_updated_at) FROM profile_tracker.pt_activity_571c
UNION ALL SELECT '80cd', MAX(last_updated_at) FROM profile_tracker.pt_activity_80cd;
```

Expected: all `last_sync` values within last 2 minutes.

**Step 3: Confirm no REDEEM rows exist**

```sql
SELECT type, COUNT(*) FROM profile_tracker.pt_activity_f705 GROUP BY type
UNION ALL SELECT type, COUNT(*) FROM profile_tracker.pt_activity_cc50 GROUP BY type
UNION ALL SELECT type, COUNT(*) FROM profile_tracker.pt_activity_571c GROUP BY type
UNION ALL SELECT type, COUNT(*) FROM profile_tracker.pt_activity_80cd GROUP BY type;
```

Expected: only TRADE and MERGE types, no REDEEM.

**Step 4: Check cron execution logs**

```sql
SELECT jobid, runid, job_pid, status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'multi-profile-activity-sync-every-minute')
ORDER BY start_time DESC LIMIT 5;
```

Expected: recent runs with status='succeeded'.

**Step 5: Confirm views work**

```sql
SELECT type, title, side, event_timestamp FROM pt_activity_f705_view ORDER BY event_timestamp DESC LIMIT 3;
```

---

## Task 6: Update CLAUDE.md

Add to the Supabase Backend section:
- Document the new `type` column on all 4 tables
- Document `multi-profile-activity-sync` edge function
- Document the pg_cron job name
- Note allowed types: TRADE, MERGE (excludes REDEEM, CONVERSION)

---

## Notes

- **Latency floor**: pg_cron's finest granularity is 1 minute. Activities appear within 60 seconds of the cron tick. This is the fastest possible without moving to a long-polling or websocket approach (which Polymarket doesn't support).
- **No SPLIT type**: The Polymarket `/activity` API does not return a `SPLIT` type. The types observed across all 4 wallets and 16,000 records are: TRADE (buy+sell), MERGE, REDEEM, CONVERSION. If Polymarket adds SPLIT in the future, update the `ALLOWED_TYPES` set in the edge function.
- **CONVERSION**: Extremely rare (3 records ever, only on 80cd). Excluded for now as it behaves like REDEEM (side='', price=0). Can be added to `ALLOWED_TYPES` later if needed.
- **tracker_size**: Remains NULL in all 4 tables. Stake percentages haven't been defined. The edge function does not compute tracker_size — add it later when config rows are created per profile.
