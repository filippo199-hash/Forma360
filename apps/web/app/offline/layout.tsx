/**
 * Root layout for the offline fallback page (PF-10). Served by the service
 * worker when a navigation fails with no connectivity — no session, no
 * providers, no chrome; it must render from cache alone.
 */
import '../globals.css';
import type { ReactNode } from 'react';

export default function OfflineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-muted/30 font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
