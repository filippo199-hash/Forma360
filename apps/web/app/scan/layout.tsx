/**
 * Root layout for public QR-scan reporting routes.
 *
 * `/scan/[token]` is reached directly from a printed QR code. There's
 * no session, no locale prefix, and no app chrome — just a single
 * white-card form on a plain background. The layout wires up only what
 * the page actually needs:
 *   - global stylesheet (Tailwind tokens),
 *   - TRPCProvider so the page can call `trpc.issues.*` public
 *     procedures (those are gated server-side as `publicProcedure`),
 *   - the global `Toaster` for inline submit feedback.
 *
 * Notably absent: SiteHeader / SiteSidebar / SiteFooter, NextIntl,
 * permissions context, theme provider. The scan flow is intentionally
 * stripped down so it loads quickly on a phone and looks clean for
 * an unauthenticated reporter.
 */
import '../globals.css';
import type { ReactNode } from 'react';
import { TRPCProvider } from '../../src/components/trpc-provider';
import { Toaster } from '../../src/components/ui/sonner';

export default function ScanLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-muted/30 font-sans text-foreground antialiased">
        <TRPCProvider>
          <main className="min-h-screen">{children}</main>
          <Toaster />
        </TRPCProvider>
      </body>
    </html>
  );
}
