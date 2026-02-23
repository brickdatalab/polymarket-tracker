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

export interface TrackerState {
  snapshots: Snapshot[];
  activity: Activity[];
  loading: boolean;
  lastUpdated: Date | null;
}
