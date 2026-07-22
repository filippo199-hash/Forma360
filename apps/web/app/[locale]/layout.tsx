import '../globals.css';

import { LOCALES } from '@forma360/i18n/config';
import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ChatBubble } from '../../src/components/ai/chat-bubble';
import { PortalHeader } from '../../src/components/portal/portal-header';
import { SiteFooter } from '../../src/components/site-footer';
import { SiteHeader } from '../../src/components/site-header';
import { SiteSidebar } from '../../src/components/site-sidebar';
import { isPathAllowedForExternal, loadContractorUser } from '../../src/server/contractor-portal';
import { ThemeProvider } from '../../src/components/theme-provider';
import { TRPCProvider } from '../../src/components/trpc-provider';
import { Toaster } from '../../src/components/ui/sonner';
import { auth } from '../../src/server/auth';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

// Display face for marketing headlines (exposed as --font-hanken; applied
// only by the public marketing components, not the app UI).
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Forma360',
  description: 'Forma360 — operational excellence platform.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);
  const isSignedIn = session !== null;

  // The public homepage (just `/<locale>`) renders as a clean landing page
  // without the app sidebar, even for signed-in users. The middleware sets
  // `x-pathname`; if it is ever absent we fall back to showing the sidebar.
  const pathname = requestHeaders.get('x-pathname') ?? '';
  const isHomePage = /^\/[a-z]{2}\/?$/.test(pathname);

  // External contractor users (Phase 4) are confined to the portal + the
  // route prefixes their granted activities unlock. Internal users have no
  // `contractor_users` row and skip all of this.
  const membership =
    isSignedIn && session.user.tenantId != null
      ? await loadContractorUser(session.user.id, session.user.tenantId as string)
      : null;
  const isExternal = membership !== null;
  if (isExternal && !isHomePage) {
    const onPortal = pathname.startsWith(`/${locale}/portal`);
    // Force the acknowledgement-onboarding step before anything else.
    if (membership.acknowledgedAt === null) {
      if (!onPortal) redirect(`/${locale}/portal`);
    } else if (!isPathAllowedForExternal(pathname, locale, membership.activities)) {
      redirect(`/${locale}/portal`);
    }
  }

  const showSidebar = isSignedIn && !isHomePage && !isExternal;
  const displayName = session?.user.name ?? '';

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} ${hanken.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <TRPCProvider>
              {isExternal && !isHomePage ? (
                /* External contractor portal — minimal shell, no internal nav. */
                <div className="flex min-h-screen flex-col">
                  <PortalHeader name={displayName} locale={locale} />
                  <main className="flex-1">{children}</main>
                </div>
              ) : showSidebar ? (
                /* Signed-in app shell — full-height dark sidebar on the left,
                 * header + content in the column to its right (Cantiere360). */
                <div className="flex min-h-screen">
                  <SiteSidebar locale={locale} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <SiteHeader showBrand={false} />
                    <main className="flex-1">{children}</main>
                  </div>
                  {/* Floating assistant launcher on every signed-in page. */}
                  <ChatBubble />
                </div>
              ) : (
                /* Public pages — header on top, marketing/legal footer below. */
                <div className="flex min-h-screen flex-col">
                  <SiteHeader />
                  <main className="flex-1">{children}</main>
                  <SiteFooter />
                </div>
              )}
              <Toaster />
            </TRPCProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
