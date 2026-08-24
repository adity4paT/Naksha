import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Naksha — Land MIS Dashboard',
  description: 'Client-side land-holdings MIS explorer over Indian administrative boundaries.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
