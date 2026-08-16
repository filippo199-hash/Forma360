/**
 * Root layout for public-share routes.
 *
 * `/s/[token]` is followed from a link a contractor emailed to a client.
 * There is no session, no locale prefix and no app chrome. What the
 * layout must wire up, and did not (RS-A2):
 *   - global stylesheet (Tailwind tokens);
 *   - **TRPCProvider**, because the RAMS client-acceptance view is a
 *     client component calling a tRPC mutation hook. Without a provider
 *     in the tree it throws on render, and the read-only pack view goes
 *     down with it — so an external recipient saw a render error instead
 *     of the pack, and neither accept nor request-changes was reachable.
 *     The procedures behind it are `publicProcedure`s gated on the
 *     opaque token, exactly like `/scan`;
 *   - the global `Toaster`, so a decision can report success or failure
 *     to someone who has no other feedback surface.
 *
 * Notably absent, as on `/scan`: header, sidebar, footer, permissions
 * context, the full NextIntl request config. The share view is
 * deliberately stripped down — but `TRPCProvider` resolves the
 * translated `serverErrors` catalogue, so the tree needs the minimal
 * English-only intl context (`PublicIntlProvider`). Mounting the
 * provider bare was NR3-01: every `/s/<token>` link a contractor sent a
 * client returned HTTP 500.
 */
import '../globals.css';
import type { ReactNode } from 'react';
import { PublicIntlProvider } from '../../src/components/public-intl-provider';
import { TRPCProvider } from '../../src/components/trpc-provider';
import { Toaster } from '../../src/components/ui/sonner';

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-muted/30 font-sans text-foreground antialiased">
        <PublicIntlProvider>
          <TRPCProvider>
            <main className="min-h-screen">{children}</main>
            <Toaster />
          </TRPCProvider>
        </PublicIntlProvider>
      </body>
    </html>
  );
}
