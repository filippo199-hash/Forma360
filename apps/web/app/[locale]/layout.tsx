import '../globals.css';

import { LOCALES } from '@forma360/i18n/config';
import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteFooter } from '../../src/components/site-footer';
import { SiteHeader } from '../../src/components/site-header';
import { SiteSidebar } from '../../src/components/site-sidebar';
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
  const showSidebar = isSignedIn && !isHomePage;

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
              {showSidebar ? (
                /* Signed-in app shell — full-height dark sidebar on the left,
                 * header + content in the column to its right (Cantiere360). */
                <div className="flex min-h-screen">
                  <SiteSidebar locale={locale} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <SiteHeader showBrand={false} />
                    <main className="flex-1">{children}</main>
                  </div>
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
