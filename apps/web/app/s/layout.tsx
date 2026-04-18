/**
 * Root layout for public-share routes. No nav, no app chrome — the
 * share view is a single read-only inspection render.
 */
import '../globals.css';
import type { ReactNode } from 'react';

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
