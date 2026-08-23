/**
 * STAB-04 — the app has error boundaries, and the last-resort one depends
 * on nothing.
 *
 * Two properties, both of which regress silently:
 *
 * 1. **Rendering errors reach Sentry.** They did not before this landed —
 *    the SDK prints a build-time warning about the missing handler that
 *    nobody reads, and the resulting failure mode is the worst kind: the
 *    user's screen is broken and the dashboard says everything is fine.
 * 2. **`global-error` cannot itself fail.** It replaces the root layout,
 *    so it renders with no intl provider, no theme provider, and no
 *    guarantee that `globals.css` was ever loaded. NR3-01 is on record as
 *    what happens when a component calls `useTranslations` somewhere no
 *    provider is mounted — it 500'd every public share page. A last-resort
 *    screen that can throw is not one.
 *
 * This is a source scan rather than a render test on purpose: what needs
 * pinning is which imports the file is allowed to have, and that is a
 * statement about the file, not about its output.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLOBAL_ERROR = join(WEB_ROOT, 'app', 'global-error.tsx');
const LOCALE_ERROR = join(WEB_ROOT, 'app', '[locale]', 'error.tsx');

/**
 * Comments are stripped before every scan. The first run of this guard
 * failed on `global-error.tsx` because its own docstring *names*
 * `useTranslations` while explaining why it must not call it — the same
 * "a comment explaining the bug quotes the bug" trap the toast scan in
 * `inline-error-render.test.ts` hit.
 */
const read = (p: string): string =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

describe('error boundaries (STAB-04)', () => {
  it('both boundaries exist and report to Sentry', () => {
    for (const file of [GLOBAL_ERROR, LOCALE_ERROR]) {
      const src = read(file);
      expect(src.startsWith("'use client';")).toBe(true);
      expect(src).toContain('Sentry.captureException(error)');
    }
  });

  it('global-error brings its own document — nothing else will', () => {
    const src = read(GLOBAL_ERROR);
    expect(src).toContain('<html');
    expect(src).toContain('<body');
  });

  it('global-error depends on no provider and no stylesheet', () => {
    const src = read(GLOBAL_ERROR);
    // No intl: there is no provider above it (NR3-01's exact shape).
    expect(src).not.toContain('useTranslations');
    expect(src).not.toContain('next-intl');
    // No app components: any of them could be the thing that just threw.
    expect(src).not.toMatch(/from '\.\.\/src\//);
    // No Tailwind: `globals.css` is imported by the locale layout, which is
    // precisely what has been replaced by the time this renders.
    expect(src).not.toMatch(/className=/);
  });

  it('neither boundary prints the raw error to the user', () => {
    // The BUG-17 / SWPD-01 rule. `digest` is the correlation hash and is
    // safe to show; `message` is for the log.
    for (const file of [GLOBAL_ERROR, LOCALE_ERROR]) {
      const src = read(file);
      expect(src).not.toMatch(/\{\s*error\.message\s*\}/);
      expect(src).toContain('error.digest');
    }
  });
});
