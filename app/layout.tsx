import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'doug_plean_tracker',
  description: 'Paper-trading tracker for Polymarket predictions.',
  openGraph: {
    title: 'doug_plean_tracker',
    description: 'Paper-trading tracker for Polymarket predictions.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
