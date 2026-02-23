import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Polymarket Tracker · @0x8dxd',
  description: 'Live P&L tracker — $17k proportional stake in @0x8dxd\'s Polymarket portfolio.',
  openGraph: {
    title: 'Polymarket Tracker · @0x8dxd',
    description: 'Live P&L tracker for a proportional stake in @0x8dxd\'s Polymarket portfolio.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
