/**
 * `appLink` — one helper, and the sweep that keeps it the only way.
 *
 * Edge cases:
 *   - AL-E01: the locale segment is the recipient's, not English
 *   - AL-E02: a missing or malformed locale falls back rather than 404s
 *   - AL-E03: trailing/leading slashes on either side collapse to one
 *   - AL-E04: no worker file may hardcode a locale segment in a link
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appLink, DEFAULT_APP_LINK_LOCALE } from './app-link';

describe('appLink', () => {
  it('AL-E01: the link lands in the reader own locale', () => {
    expect(appLink('https://freehs.software', 'fr', '/documents/abc')).toBe(
      'https://freehs.software/fr/documents/abc',
    );
    // A locale with UI messages but no email template still gets its own
    // link — the body falls back to English, the page does not have to.
    expect(appLink('https://freehs.software', 'ja', 'incidents/xyz')).toBe(
      'https://freehs.software/ja/incidents/xyz',
    );
  });

  it('AL-E02: a missing or malformed locale falls back instead of 404ing', () => {
    for (const bad of [null, undefined, '', 'en-GB', 'ENGLISH', 'x', '../etc']) {
      expect(appLink('https://freehs.software', bad, '/actions')).toBe(
        `https://freehs.software/${DEFAULT_APP_LINK_LOCALE}/actions`,
      );
    }
  });

  it('AL-E03: slashes on either side collapse to exactly one', () => {
    expect(appLink('https://freehs.software/', 'it', '/permits/1')).toBe(
      'https://freehs.software/it/permits/1',
    );
    expect(appLink('https://freehs.software///', 'it', '///permits/1')).toBe(
      'https://freehs.software/it/permits/1',
    );
    // A bare module link (no id) must not end in a stray slash.
    expect(appLink('https://freehs.software', 'it', '')).toBe('https://freehs.software/it');
    expect(appLink('https://freehs.software', 'it', '/')).toBe('https://freehs.software/it');
  });
});

/**
 * AL-E04 — the reason this helper exists.
 *
 * Ten workers independently baked `/en/` into the links they emailed, each
 * one beside a `locale` it was already carrying. Reviewing prose caught it
 * three times in three separate audits and would have caught the eleventh
 * the same way: too late. This walks the worker sources instead.
 */
const WORKERS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'jobs',
  'src',
  'workers',
);

/**
 * A locale segment wedged into a URL path inside a template literal —
 * `.../en/documents/...`. Deliberately narrow: it only fires on a
 * two-letter segment between slashes that is followed by more path or a
 * closing backtick, which is what a hardcoded app link looks like and what
 * an interpolated `${...}` one never does.
 */
const HARDCODED_LOCALE_IN_LINK = /\$\{[^}]*appUrl[^}]*\}[^`]*?\/(?:[a-z]{2})\//;

describe('worker links', () => {
  it('AL-E04: no worker hardcodes a locale segment — use appLink', async () => {
    const files = (await readdir(WORKERS_DIR)).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(WORKERS_DIR, file), 'utf-8');
      for (const [i, line] of source.split('\n').entries()) {
        if (HARDCODED_LOCALE_IN_LINK.test(line)) {
          offenders.push(`${file}:${i + 1} ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
