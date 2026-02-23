import Dashboard from '@/components/Dashboard';

// Minimal server shell — all data fetching happens client-side
// so the page works purely statically on Vercel.
export default function Home() {
  return <Dashboard />;
}
