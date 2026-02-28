export interface Snapshot {
  id: number;
  captured_at: string;
  profile_value: number;
  tracker_value: number;
  tracker_pnl: number;
}

export interface Activity {
  id: number;
  condition_id: string;
  title: string;
  slug: string | null;
  outcome: string | null;
  side: string | null;
  icon_url: string | null;
  usdc_size: number;
  tracker_size: number;
  price: number | null;
  event_timestamp: string | null;
  first_seen_at: string;
  last_updated_at: string;
}

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

export interface TrackerState {
  snapshots: Snapshot[];
  activity: Activity[];
  loading: boolean;
  lastUpdated: Date | null;
}
