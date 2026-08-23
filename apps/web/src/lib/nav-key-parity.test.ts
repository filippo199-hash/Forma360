/**
 * SWP-E1 — nav.* key parity across every locale bundle.
 *
 * The nav binds its labels through variables (`t(entry.labelKey)`), which
 * is exactly the hole K01 cannot see (the K02 lesson): a key added to
 * `en` only renders as its raw path — `nav.child.fireSafetySettings` —
 * in the other nine locales' navigation, the most-seen chrome in the
 * product. next-intl fails silent in CI and loud on screen, so parity
 * is pinned here instead. The nav namespace is small and bounded, so a
 * full-parity rule holds without the false-positive noise that killed
 * the general variable-key guard.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MESSAGES_DIR = join(__dirname, '..', '..', '..', '..', 'packages', 'i18n', 'messages');

type Tree = { [key: string]: Tree | string };

function flatKeys(tree: Tree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.push(path);
    else out.push(...flatKeys(value, path));
  }
  return out;
}

describe('nav key parity (SWP-E1)', () => {
  const locales = readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  const bundles = new Map<string, Tree>(
    locales.map((locale) => [
      locale,
      (JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8')) as { nav?: Tree })
        .nav ?? {},
    ]),
  );

  it('every locale carries every nav.* key en has', () => {
    const enKeys = new Set(flatKeys(bundles.get('en') ?? {}));
    expect(enKeys.size).toBeGreaterThan(10);
    const gaps: Record<string, string[]> = {};
    for (const [locale, tree] of bundles) {
      if (locale === 'en') continue;
      const missing = [...enKeys].filter((k) => !flatKeys(tree).includes(k)).sort();
      if (missing.length > 0) gaps[locale] = missing;
    }
    expect(gaps).toEqual({});
  });

  it('no locale carries a nav.* key en does not (dead keys drift)', () => {
    const enKeys = new Set(flatKeys(bundles.get('en') ?? {}));
    const extras: Record<string, string[]> = {};
    for (const [locale, tree] of bundles) {
      if (locale === 'en') continue;
      const extra = flatKeys(tree)
        .filter((k) => !enKeys.has(k))
        .sort();
      if (extra.length > 0) extras[locale] = extra;
    }
    expect(extras).toEqual({});
  });
});
