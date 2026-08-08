/**
 * The sandbox namespace must be complete in every locale.
 *
 * next-intl throws at RENDER time on a missing key, so a locale that
 * lost a key does not fail the build — it fails the visitor, and only
 * in that language. The save prompt is the one screen in the funnel
 * where that is unrecoverable: the workspace is unclaimed, the visitor
 * cannot hand over an email, and the work is lost when the session
 * expires.
 *
 * This scrapes the component for its `t('key')` calls rather than
 * hardcoding a list, so adding a key to the component and forgetting
 * nine translations fails here. Same shape as the action-sources and
 * search-categories guards.
 *
 * Edge-case ID: SB-I01.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'i18n', 'messages');
const BANNER = join(__dirname, 'sandbox-banner.tsx');

/** Every `t('…')` the component calls, in source order. */
function keysUsedByComponent(): string[] {
  const source = readFileSync(BANNER, 'utf-8');
  const matches = source.matchAll(/\bt\('([a-zA-Z][a-zA-Z0-9_]*)'/g);
  return [...new Set([...matches].map((m) => m[1] as string))];
}

interface Bundle {
  sandbox?: Record<string, unknown>;
}

describe('SB-I01 — sandbox i18n completeness', () => {
  const used = keysUsedByComponent();
  const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'));

  it('scrapes a realistic set of keys from the component', () => {
    // Guards the guard: if the regex stops matching, every assertion
    // below would pass vacuously.
    expect(used.length).toBeGreaterThanOrEqual(10);
    expect(used).toContain('bannerTitle');
    expect(used).toContain('submit');
  });

  it('ships all ten locales', () => {
    expect(locales.length).toBe(10);
  });

  for (const file of readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))) {
    it(`${file} carries every sandbox key the component uses`, () => {
      const bundle = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf-8')) as Bundle;
      const sandbox = bundle.sandbox;
      expect(sandbox, `${file} has no sandbox namespace`).toBeDefined();

      const missing = used.filter((k) => sandbox?.[k] === undefined);
      expect(missing, `${file} is missing: ${missing.join(', ')}`).toEqual([]);

      // An empty string renders as nothing, which looks like a bug.
      for (const key of used) {
        expect(
          String(sandbox?.[key] ?? '').trim().length,
          `${file}.${key} is blank`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
