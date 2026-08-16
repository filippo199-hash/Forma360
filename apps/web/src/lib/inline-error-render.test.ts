/**
 * BUG-17: the contractor-review workspace rendered the raw guard key
 * ('conditions-required') inline next to the field — the toast path was
 * fixed, the inline path was not. Every inline error render on that page
 * must resolve through `serverErrorMessage` / `useServerErrorMessage`.
 *
 * Scraped, house pattern of search-categories.test.ts: the same
 * raw-`.error.message}` class exists at ~10 sites app-wide — widen the
 * file list as they are fixed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GUARDED_PAGES = ['app/[locale]/rams/reviews/page.tsx'];

describe('inline server-error rendering (BUG-17)', () => {
  for (const page of GUARDED_PAGES) {
    it(`${page} never interpolates a raw tRPC message into JSX`, () => {
      const source = readFileSync(resolve(process.cwd(), page), 'utf8');
      // `{foo.error.message}` puts the kebab-case guard key on screen.
      expect(source).not.toMatch(/\{\s*\w+\.error\.message\s*\}/);
      // …and so does rendering the stored intake error string directly.
      expect(source).not.toMatch(/\{\s*intakeError\s*\}/);
      expect(source).toContain('useServerErrorMessage');
    });
  }
});
