import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton client for browser use
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnon);
  }
  return _client;
}

export async function fetchSnapshots(limit = 1440) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('pt_snapshots_view')
    .select('*')
    .order('captured_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchActivity(limit = 50) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('pt_activity_view')
    .select('*')
    .order('event_timestamp', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
