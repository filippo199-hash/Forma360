/**
 * Minimal English-only intl context for the PUBLIC, sessionless routes
 * (`/s/[token]`, `/scan/[token]`).
 *
 * Those layouts deliberately skip the full NextIntl request config — an
 * external recipient has no locale preference we know, and the shared
 * content renders in whatever language it was authored in. That stance
 * broke in NR3-01: `TRPCProvider` grew `useTranslations('serverErrors')`
 * bindings (the translated guard-key catalogue), so mounting it without
 * ANY intl context made every public share page throw on render — the
 * client-facing RAMS share link returned HTTP 500, and `/scan` went down
 * with it.
 *
 * The fix is not to un-translate the provider (the catalogue is the
 * product's error copy, kept complete by I18N-SE01) but to give public
 * routes the smallest context that satisfies it: locale `en`, plus only
 * the namespaces the public surface actually resolves. This is a server
 * component, so the full `en.json` import stays on the server and only
 * the subset below crosses to the client bundle.
 */
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@forma360/i18n/messages/en';

/**
 * Namespaces the public tree resolves: `serverErrors` + `common` via
 * `TRPCProvider`'s mutation-error toast and inline guard-key rendering.
 * Exported so the composition test can assert the subset stays honest.
 */
export const PUBLIC_MESSAGE_NAMESPACES = ['serverErrors', 'common'] as const;

const messages = Object.fromEntries(
  PUBLIC_MESSAGE_NAMESPACES.map((ns) => [ns, (en as Record<string, unknown>)[ns]]),
);

export function PublicIntlProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
