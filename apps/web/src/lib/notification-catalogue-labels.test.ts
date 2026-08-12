/**
 * Notification catalogue ↔ locale bundle guard (NP-K01, the I18N-K01
 * lesson applied to the bell + prefs table): next-intl renders the raw
 * key path when a label is missing, so a catalogue kind without a
 * `notifications.kinds.<kind>` entry ships silently in CI and loudly on
 * screen. The prefs table and the bell both label rows from the
 * catalogue dynamically, which is exactly the hole K01 cannot see.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTIFICATION_EVENTS, NOTIFICATION_GROUPS } from '@forma360/shared/notification-catalogue';
import { describe, expect, it } from 'vitest';

const MESSAGES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'i18n',
  'messages',
);

interface LocaleBundle {
  notifications?: {
    kinds?: Record<string, string>;
    prefs?: { groups?: Record<string, string> } & Record<string, unknown>;
  };
}

describe('notification catalogue labels (NP-K01)', () => {
  const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'));

  it('covers all 10 locales', () => {
    expect(locales.length).toBe(10);
  });

  for (const file of locales) {
    it(`${file}: every kind, group and prefs string is present`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf-8'));
      // Boundary: locale bundles are repo-controlled JSON.
      const bundle = raw as LocaleBundle;
      const kinds = bundle.notifications?.kinds ?? {};
      const prefs = bundle.notifications?.prefs ?? {};
      const groups = bundle.notifications?.prefs?.groups ?? {};

      for (const event of NOTIFICATION_EVENTS) {
        expect(kinds[event.kind], `notifications.kinds.${event.kind} missing in ${file}`).toEqual(
          expect.any(String),
        );
      }
      for (const group of NOTIFICATION_GROUPS) {
        expect(groups[group], `notifications.prefs.groups.${group} missing in ${file}`).toEqual(
          expect.any(String),
        );
      }
      for (const key of ['title', 'subtitle', 'saveError', 'eventColumn', 'email', 'inApp']) {
        expect(prefs[key], `notifications.prefs.${key} missing in ${file}`).toEqual(
          expect.any(String),
        );
      }
    });
  }
});
