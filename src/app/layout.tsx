import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EasyCut AI — Upload your footage. Get a finished video.',
  description:
    'Drop in your talking-head footage and get back a fully edited video: captions, B-roll, motion graphics, sound design and music. No editing knowledge required.',
  openGraph: {
    title: 'EasyCut AI',
    description: 'Upload your footage. Get a finished video.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0D0D10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-screen bg-ink font-sans text-chalk antialiased">{children}</body>
    </html>
  );
}
