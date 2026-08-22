/**
 * BUG-17: the contractor-review workspace rendered the raw guard key
 * ('conditions-required') inline next to the field — the toast path was
 * fixed, the inline path was not. Every inline error render must resolve
 * through `serverErrorMessage` / `useServerErrorMessage`.
 *
 * This began as an allowlist of the pages that had been fixed, on the
 * reasoning that ~10 sites still carried the raw pattern. That reasoning
 * expired: an allowlist can only ever pin what someone remembered to add
 * to it, and SWP-C1 fixed one RAMS page while two more — `rams/new` and
 * the briefing capture screen a foreman actually uses — kept rendering
 * `{x.error.message}` unnoticed. The last of them is now fixed, so the
 * guard scans EVERY page and component instead. No new one can appear.
 *
 * If it ever fires on something that is genuinely not a tRPC error — an
 * error boundary rendering a JS `Error`, say — the answer is still not to
 * exempt the file: decide whether that message is fit for a user to read,
 * and if it is, give it a name of its own rather than the `.error.message`
 * shape this scan exists to find.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(process.cwd());

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) acc.push(full);
  }
  return acc;
}

describe('inline server-error rendering (BUG-17)', () => {
  it('no page interpolates a raw tRPC message into JSX', () => {
    const offenders: string[] = [];
    for (const file of [
      ...sourceFiles(join(WEB_ROOT, 'app')),
      ...sourceFiles(join(WEB_ROOT, 'src')),
    ]) {
      const source = readFileSync(file, 'utf8');
      // `{foo.error.message}` puts the kebab-case guard key on screen.
      if (/\{\s*\w+\.error\.message\s*\}/.test(source)) {
        offenders.push(relative(WEB_ROOT, file));
      }
    }
    expect({ rawErrorRenders: offenders.sort() }).toEqual({ rawErrorRenders: [] });
  });

  /**
   * SWPD-01, the same class in the toast path.
   *
   * 88 call sites did `onError: (err) => toast.error(err.message …)`, which
   * puts whatever the server said on screen: for a domain guard that is the
   * kebab-case key (`gas-test-stale`), and for anything unexpected it is
   * internal text. `serverErrorMessage` exists to resolve the first and
   * suppress the second, and the fix was invisible to the inline scan above
   * because a toast is not JSX.
   *
   * Error injection is what found it — the module-local resolvers
   * (`permitErrorText`, `contractorErrorMessage`) and the hand-written
   * upload paths were all correct; only the tRPC `onError` shorthand leaked.
   * Those resolvers are why this matches the bare member access and not a
   * call that wraps it.
   */
  it('no mutation toasts a raw server message', () => {
    const offenders: string[] = [];
    for (const file of [
      ...sourceFiles(join(WEB_ROOT, 'app')),
      ...sourceFiles(join(WEB_ROOT, 'src')),
    ]) {
      const source = readFileSync(file, 'utf8');
      // `toast.error(err.message === 'has-action' ? … : …)` COMPARES the
      // guard key and picks translated copy — that is the correct pattern,
      // not the bug. Only rendering the message is.
      if (/toast\.(error|warning)\(\s*(err|e)\.message(?!\s*===)/.test(source)) {
        offenders.push(relative(WEB_ROOT, file));
      }
    }
    expect({ rawErrorToasts: offenders.sort() }).toEqual({ rawErrorToasts: [] });
  });

  // The two pages the class was found on keep their pointed pin: the
  // stored-string variant below has no general shape to scan for.
  const GUARDED_PAGES = [
    'app/[locale]/rams/reviews/page.tsx',
    'app/[locale]/rams/[packId]/page.tsx',
  ];
  for (const page of GUARDED_PAGES) {
    it(`${page} resolves its errors through the helper`, () => {
      const source = readFileSync(resolve(process.cwd(), page), 'utf8');
      // Rendering the stored intake error string directly is the same bug
      // wearing a local variable.
      expect(source).not.toMatch(/\{\s*intakeError\s*\}/);
      expect(source).toContain('useServerErrorMessage');
    });
  }

  // UXW1-05, the streaming cousin of the same class: the assistant page
  // rendered `Error: ${event.message}` — the raw provider payload, status
  // code and request id included — as the assistant's reply. Stream
  // failures must resolve through the translated streamError copy.
  const RAW_STREAM_GUARDS = ['src/components/ai/ai-chat.tsx'];
  for (const page of RAW_STREAM_GUARDS) {
    it(`${page} never renders a raw stream-error payload`, () => {
      const source = readFileSync(resolve(process.cwd(), page), 'utf8');
      expect(source).not.toMatch(/\$\{\s*event\.message\s*\}/);
      expect(source).toContain("t('streamError')");
    });
  }
});
