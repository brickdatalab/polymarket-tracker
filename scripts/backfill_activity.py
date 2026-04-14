#!/usr/bin/env python3
"""
Polymarket Activity Backfill Script

Fetches full activity history from Polymarket Data API for specified wallets.
Outputs CSV files formatted for direct upload to Supabase pt_activity_* tables.

Usage:
    python scripts/backfill_activity.py --profile cc50        # justdance only
    python scripts/backfill_activity.py                       # all 4 profiles
    python scripts/backfill_activity.py --include-all         # include REDEEM, etc.
"""

from __future__ import annotations

import csv
import json
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

# ── Config ──────────────────────────────────────────────────────────────────

DATA_API = "https://data-api.polymarket.com"
LIMIT = 1000
MAX_OFFSET = 3000  # API hard wall: 4 pages × 1000 = 4000 raw records max
SLEEP_BETWEEN_PAGES = 0.25  # seconds — stay well under rate limits

PROFILES: dict[str, dict[str, str]] = {
    "f705": {"wallet": "0xf705fa045201391d9632b7f3cde06a5e24453ca7", "name": "(anon)"},
    "cc50": {"wallet": "0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82", "name": "justdance"},
    "571c": {"wallet": "0x571c285a83eba5322b5f916ba681669dc368a61f", "name": "dustedfloor"},
    "80cd": {"wallet": "0x80cd8310aa624521e9e1b2b53b568cafb0ef0273", "name": "(anon)"},
}

ALLOWED_TYPES = {"TRADE", "MERGE"}

# CSV columns matching Supabase pt_activity_* schema (excluding auto-gen id)
CSV_COLUMNS = [
    "condition_id",
    "title",
    "slug",
    "outcome",
    "side",
    "icon_url",
    "usdc_size",
    "tracker_size",
    "price",
    "event_timestamp",
    "first_seen_at",
    "last_updated_at",
    "type",
]


# ── API Fetching ────────────────────────────────────────────────────────────

def fetch_page(wallet: str, offset: int, limit: int = LIMIT) -> list[dict]:
    """Fetch one page of activity from the Polymarket Data API."""
    url = f"{DATA_API}/activity?user={wallet}&limit={limit}&offset={offset}"
    req = Request(url, headers={"User-Agent": "polymarket-backfill/1.0"})

    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except HTTPError as e:
        print(f"    HTTP {e.code}: {e.reason}")
        return []
    except URLError as e:
        print(f"    Network error: {e.reason}")
        return []

    if not isinstance(data, list):
        print(f"    Unexpected response type: {type(data).__name__}")
        return []

    return data


def fetch_all_activity(wallet: str, profile_id: str) -> list[dict]:
    """Fetch all pages of activity for a wallet. Returns raw API records."""
    all_records: list[dict] = []

    for offset in range(0, MAX_OFFSET + 1, LIMIT):
        page_num = offset // LIMIT + 1
        print(f"  Page {page_num}/4 (offset={offset})...", end=" ", flush=True)

        batch = fetch_page(wallet, offset, LIMIT)
        print(f"{len(batch)} records")

        if not batch:
            break

        all_records.extend(batch)

        if len(batch) < LIMIT:
            print(f"  Last page reached ({len(batch)} < {LIMIT})")
            break

        time.sleep(SLEEP_BETWEEN_PAGES)

    return all_records


# ── Data Processing ─────────────────────────────────────────────────────────

def deduplicate_by_condition(records: list[dict]) -> list[dict]:
    """Deduplicate by conditionId, keeping the first occurrence."""
    seen: set[str] = set()
    unique: list[dict] = []

    for r in records:
        cid = r.get("conditionId", "")
        if cid and cid not in seen:
            seen.add(cid)
            unique.append(r)

    return unique


def api_record_to_row(record: dict) -> dict[str, str | float]:
    """Convert a raw API record to a CSV row matching the Supabase table schema."""
    ts_unix = record.get("timestamp", 0)
    event_ts = ""
    if ts_unix:
        event_ts = datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat()

    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "condition_id": record.get("conditionId", ""),
        "title": record.get("title", ""),
        "slug": record.get("slug") or "",
        "outcome": record.get("outcome") or "",
        "side": record.get("side") or "",
        "icon_url": record.get("icon") or "",
        "usdc_size": record.get("usdcSize", 0),
        "tracker_size": "",  # NULL — not used for source profiles
        "price": record.get("price") or "",
        "event_timestamp": event_ts,
        "first_seen_at": now_iso,
        "last_updated_at": now_iso,
        "type": record.get("type", "TRADE"),
    }


# ── Main ────────────────────────────────────────────────────────────────────

def process_profile(
    profile_id: str,
    wallet: str,
    name: str,
    output_dir: Path,
    include_all: bool,
) -> Path | None:
    """Fetch, process, and save one profile's activity to CSV."""
    print(f"\n{'='*60}")
    print(f"Profile: {profile_id} — {name} ({wallet[:8]}...{wallet[-4:]})")
    print(f"{'='*60}")

    # 1. Fetch all pages
    raw = fetch_all_activity(wallet, profile_id)
    if not raw:
        print("  No records returned. Skipping.")
        return None
    print(f"  Total raw records: {len(raw)}")

    # 2. Show type breakdown before filtering
    type_counts: dict[str, int] = {}
    for r in raw:
        t = r.get("type", "UNKNOWN")
        type_counts[t] = type_counts.get(t, 0) + 1
    print(f"  Type breakdown: {type_counts}")

    # 3. Filter by type
    if not include_all:
        filtered = [r for r in raw if r.get("type") in ALLOWED_TYPES]
        excluded = len(raw) - len(filtered)
        print(f"  After TRADE+MERGE filter: {len(filtered)} (excluded {excluded})")
    else:
        filtered = raw

    # 4. Deduplicate by conditionId
    unique = deduplicate_by_condition(filtered)
    dupes = len(filtered) - len(unique)
    print(f"  After dedup by conditionId: {len(unique)} (removed {dupes} dupes)")

    # 5. Convert to rows
    rows = [api_record_to_row(r) for r in unique]

    # 6. Sort by event_timestamp ascending (oldest first — matches table convention)
    rows.sort(key=lambda r: str(r["event_timestamp"]))

    # 7. Stats
    if rows:
        earliest = str(rows[0]["event_timestamp"])[:10]
        latest = str(rows[-1]["event_timestamp"])[:10]
        buy_count = sum(1 for r in rows if r["side"] == "BUY")
        sell_count = sum(1 for r in rows if r["side"] == "SELL")
        print(f"  Date range: {earliest} → {latest}")
        print(f"  BUY: {buy_count} | SELL: {sell_count} | Other: {len(rows) - buy_count - sell_count}")

    # 8. Write CSV
    filename = output_dir / f"pt_activity_{profile_id}_backfill.csv"
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"  Saved: {filename} ({len(rows)} rows)")
    return filename


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill Polymarket activity to CSV for Supabase upload"
    )
    parser.add_argument(
        "--profile",
        choices=list(PROFILES.keys()),
        help="Fetch a single profile (default: all 4)",
    )
    parser.add_argument(
        "--include-all",
        action="store_true",
        help="Include all activity types (default: TRADE + MERGE only)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="scripts/output",
        help="Output directory for CSV files (default: scripts/output)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.profile:
        targets = {args.profile: PROFILES[args.profile]}
    else:
        targets = PROFILES

    start = time.time()
    saved_files: list[Path] = []

    for pid, info in targets.items():
        result = process_profile(
            profile_id=pid,
            wallet=info["wallet"],
            name=info["name"],
            output_dir=output_dir,
            include_all=args.include_all,
        )
        if result:
            saved_files.append(result)

    elapsed = time.time() - start

    # Summary
    print(f"\n{'='*60}")
    print(f"DONE — {len(saved_files)} file(s) saved in {elapsed:.1f}s")
    print(f"{'='*60}")
    for f in saved_files:
        print(f"  {f}")

    print(f"\n  Upload instructions:")
    print(f"  1. Go to Supabase Table Editor → pt_activity_<profile_id>")
    print(f"  2. TRUNCATE the table first (or delete all rows)")
    print(f"  3. Click 'Insert' → 'Import data from CSV'")
    print(f"  4. Upload the corresponding CSV file")
    print(f"  5. The trade copier cron will pick up new trades within 1 min")


if __name__ == "__main__":
    main()
