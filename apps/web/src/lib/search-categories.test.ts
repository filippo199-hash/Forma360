import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Suffixed so a locale binding cannot shadow a vitest global.
import deMessages from '@forma360/i18n/messages/de';
import enMessages from '@forma360/i18n/messages/en';
import esMessages from '@forma360/i18n/messages/es';
import frMessages from '@forma360/i18n/messages/fr';
import itMessages from '@forma360/i18n/messages/it';
import jaMessages from '@forma360/i18n/messages/ja';
import nlMessages from '@forma360/i18n/messages/nl';
import plMessages from '@forma360/i18n/messages/pl';
import ptMessages from '@forma360/i18n/messages/pt';
import zhMessages from '@forma360/i18n/messages/zh';
import { describe, expect, it } from 'vitest';

import { SEARCH_CATEGORIES } from './search-categories';

type Bundle = { search: { categories: Record<string, unknown> } };

const bundles: ReadonlyArray<[string, Bundle]> = (
  [
    ['en', enMessages],
    ['de', deMessages],
    ['es', esMessages],
    ['fr', frMessages],
    ['it', itMessages],
    ['ja', jaMessages],
    ['nl', nlMessages],
    ['pl', plMessages],
    ['pt', ptMessages],
    ['zh', zhMessages],
  ] as ReadonlyArray<[string, unknown]>
).map(([locale, bundle]) => [locale, bundle as Bundle]);

/**
 * The keys `search.global` puts on its result object, scraped from the
 * router's single `return { … }`. Vitest runs with cwd at `apps/web`.
 */
function serverCategoryKeys(): ReadonlyArray<string> {
  const source = readFileSync(
    resolve(process.cwd(), '../../packages/api/src/routers/search.ts'),
    'utf8',
  );
  // The resolver's return object is the last `return {` in the file.
  const start = source.lastIndexOf('return {');
  expect(start, 'search router still returns a result object').toBeGreaterThan(-1);
  const body = source.slice(start);
  // Top-level keys are indented exactly 8 spaces inside the returned literal.
  return [...body.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1] as string);
}

describe('Cmd-K search categories', () => {
  it('renders every category the server can return', () => {
    // PF-6 then RS-A9: the palette iterates a hand-maintained list, so a
    // server-side category with no entry here is silently discarded.
    const server = [...serverCategoryKeys()].sort();
    const client = SEARCH_CATEGORIES.map((c) => c.key).sort();
    expect(server.length).toBeGreaterThan(0);
    expect(client).toEqual(server);
  });

  it('has a unique key and base path per category', () => {
    expect(new Set(SEARCH_CATEGORIES.map((c) => c.key)).size).toBe(SEARCH_CATEGORIES.length);
    expect(new Set(SEARCH_CATEGORIES.map((c) => c.basePath)).size).toBe(SEARCH_CATEGORIES.length);
  });

  it('resolves every category label in all ten locales', () => {
    for (const [locale, bundle] of bundles) {
      for (const def of SEARCH_CATEGORIES) {
        const key = def.labelKey.replace(/^categories\./, '');
        expect(bundle.search.categories[key], `${locale}.search.${def.labelKey}`).toBeTypeOf(
          'string',
        );
      }
    }
  });

  it('sends RAMS hits to the pack page', () => {
    const rams = SEARCH_CATEGORIES.find((c) => c.key === 'rams');
    expect(rams).toBeDefined();
    expect(rams?.basePath).toBe('rams');
  });
});
