/**
 * Every literal translation key the app asks for must exist (I18N-K01).
 *
 * next-intl's production fallback for a missing key is to render the key
 * path itself, so the failure is silent in CI and loud on screen. Two
 * separate practitioner reviews caught it in the wild:
 *
 *   - `permits.types.requiredTraining*` printed on all nine permit types,
 *     because the strings sat one level too high in every bundle;
 *   - `fireSafety.fra.ignitionSources` and its three neighbours printed
 *     as field labels on the fire risk assessment — the fire triangle,
 *     rendered as programmer strings on the most safety-critical form in
 *     the module. "If a buyer's fire consultant sees this, the
 *     conversation ends."
 *
 * Both were invisible to typecheck, lint and every other test. This
 * scrapes the source instead: for each `useTranslations('ns')` binding it
 * collects the literal `t('key')` calls made through it and asserts the
 * combined path resolves to a string in the English bundle.
 *
 * Two tests, and the split is the point. The scan (K01) is broad and
 * found eleven genuinely-missing keys on its first run — but it would
 * have sailed straight past the FRA bug, whose labels reach `t()`
 * through a variable. K02 pins that one form directly. Neither
 * subsumes the other, and pretending the scan alone is sufficient is
 * how the second review found the same class of defect as the first.
 *
 * Deliberately narrow, so it stays true rather than becoming a suite
 * people silence:
 *   - Template-literal and `as never` keys remain out of reach; nothing
 *     static can know them, and guessing would mean false alarms.
 *   - A name bound in more than one scope (a file with two `const t =`
 *     at different namespaces is common) passes if the key resolves
 *     under ANY of its bindings.
 *   - English only. Bundle parity across locales is a different test's
 *     job; this one is about keys that exist nowhere.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(WEB_ROOT, '..', '..');

type Bundle = { [key: string]: string | Bundle };

function loadBundle(path: string): Bundle {
  return JSON.parse(readFileSync(path, 'utf8')) as Bundle;
}

function deepMerge(base: Bundle, over: Bundle): Bundle {
  const out: Bundle = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const existing = out[k];
    out[k] =
      typeof existing === 'object' && existing !== null && typeof v === 'object' && v !== null
        ? deepMerge(existing, v)
        : v;
  }
  return out;
}

function resolveKey(bundle: Bundle, path: string): string | null {
  let cur: string | Bundle | undefined = bundle;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return null;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : null;
}

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/**
 * Strip comments so a `t('create.title')` inside a usage example in a
 * JSDoc block is not mistaken for a real call — `focused-page-shell.tsx`
 * carries exactly that.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const DECLARATION =
  /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g;

describe('translation keys', () => {
  const messages = deepMerge(
    loadBundle(join(REPO_ROOT, 'packages/i18n/messages/en.json')),
    loadBundle(join(REPO_ROOT, 'packages/i18n/overrides/freehs/en.json')),
  );

  it('I18N-K01 — every literal t() key in the app resolves to a string', () => {
    const files = [...walkTsx(join(WEB_ROOT, 'app')), ...walkTsx(join(WEB_ROOT, 'src'))];
    const misses: string[] = [];
    let checked = 0;

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const namespaces = new Map<string, Set<string>>();
      for (const m of source.matchAll(DECLARATION)) {
        const [, name, namespace] = m;
        if (name === undefined || namespace === undefined) continue;
        const set = namespaces.get(name) ?? new Set<string>();
        set.add(namespace);
        namespaces.set(name, set);
      }

      for (const [name, spaces] of namespaces) {
        // `(?<![\w.])` so `tStatus(` and `obj.t(` don't match `t(`.
        const calls = new RegExp(`(?<![\\w.])${name}\\(\\s*'([^']+)'\\s*[,)]`, 'g');
        for (const call of source.matchAll(calls)) {
          const key = call[1];
          if (key === undefined) continue;
          checked++;
          const found = [...spaces].some((ns) => resolveKey(messages, `${ns}.${key}`) !== null);
          if (!found) {
            misses.push(`${[...spaces].join('|')}.${key}  (${relative(REPO_ROOT, file)})`);
          }
        }
      }
    }

    // Guards the guard: a regex that silently stops matching would make
    // this test pass forever while checking nothing.
    expect(checked).toBeGreaterThan(4000);
    expect(misses, `these keys render as raw text on screen:\n${misses.join('\n')}`).toEqual([]);
  });

  /**
   * The literal pass above cannot see keys handed to `t()` through a
   * variable, and that is exactly how the FRA bug shipped:
   *
   *     ([['ignitionSources', 'ignitionSources'], …] as const)
   *       .map(([key, labelKey]) => <Label>{t(labelKey)}</Label>)
   *
   * A general rule for that shape produced ~40 false positives — most
   * dynamic keys carry a prefix (`t(`routes.${k}`)`) that no regex can
   * recover — and a guard that cries wolf gets deleted. So this pins the
   * one form that actually broke, in the same style as
   * `permit-type-controls.test.ts`: the fire triangle is the core of any
   * fire risk assessment, and it rendered as programmer strings.
   */
  it('I18N-K02 — the FRA fire-triangle labels resolve (they shipped as raw keys)', () => {
    const page = readFileSync(
      join(WEB_ROOT, 'app/[locale]/fire-safety/fra/[fraId]/page.tsx'),
      'utf8',
    );
    // If the page stops feeding these through `t`, this test is stale.
    expect(page).toContain('{t(labelKey)}');

    for (const key of ['ignitionSources', 'fuelSources', 'oxygenSources', 'evaluationNotes']) {
      expect(page, `${key} is no longer on the FRA form`).toContain(`'${key}'`);
      expect(
        resolveKey(messages, `fireSafety.fra.${key}`),
        `fireSafety.fra.${key} would render as a raw key on the FRA form`,
      ).toBeTypeOf('string');
    }

    // The heading over those fields said "Persons at risk" — the wrong
    // section entirely — while the fire hazards had no heading of their own.
    expect(resolveKey(messages, 'fireSafety.fra.hazardsHeading')).toBe('Fire hazards');
    expect(resolveKey(messages, 'fireSafety.fra.occupancyHeading')).toBe('Persons at risk');
  });
});
