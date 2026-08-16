/**
 * NR3-01 regression pin.
 *
 * The public, sessionless layouts (`/s/[token]`, `/scan/[token]`) mount
 * `TRPCProvider` without the full NextIntl request config. When
 * `TRPCProvider` gained `useTranslations('serverErrors')` bindings, that
 * combination threw on every render — the RAMS client share link (the
 * whole point of issuing a pack to a client) returned HTTP 500, and the
 * `/scan` QR reporting flow went down with it, silently.
 *
 * These tests pin both sides of the fix:
 *   1. `TRPCProvider` inside `PublicIntlProvider` renders — the exact
 *      composition both public layouts use.
 *   2. The provider's message subset actually carries the namespaces the
 *      public tree resolves, so a future namespace rename cannot
 *      silently ship an empty catalogue.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@forma360/i18n/messages/en';
import { PUBLIC_MESSAGE_NAMESPACES, PublicIntlProvider } from './public-intl-provider';
import { TRPCProvider } from './trpc-provider';

afterEach(cleanup);

describe('PublicIntlProvider (NR3-01)', () => {
  it('renders TRPCProvider without the full app intl config — the /s and /scan layout composition', () => {
    render(
      <PublicIntlProvider>
        <TRPCProvider>
          <p>share content</p>
        </TRPCProvider>
      </PublicIntlProvider>,
    );
    expect(screen.getByText('share content')).toBeDefined();
  });

  it('carries every namespace the public tree resolves, non-empty', () => {
    const bundle = en as Record<string, Record<string, unknown> | undefined>;
    for (const ns of PUBLIC_MESSAGE_NAMESPACES) {
      const messages = bundle[ns];
      expect(messages, `namespace "${ns}" missing from en.json`).toBeDefined();
      expect(Object.keys(messages ?? {}).length).toBeGreaterThan(0);
    }
  });
});
