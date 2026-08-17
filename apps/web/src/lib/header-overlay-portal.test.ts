/**
 * A hand-rolled overlay rendered from inside the site header must portal
 * out of it (HDR-P01).
 *
 * The site header carries `backdrop-blur`, and an element with a
 * `backdrop-filter` becomes the containing block for every `position: fixed`
 * descendant. The global-search modal was a `fixed inset-0` child of that
 * header, so its backdrop sized itself to the HEADER rather than the
 * viewport: measured at 1200×70 instead of 1200×700. Two user-visible
 * consequences, one cause — the page behind stayed mostly undimmed, and a
 * click anywhere in that undimmed area never landed on the backdrop, so
 * click-outside-to-close silently did nothing.
 *
 * Nothing in TypeScript or ESLint can see this: the markup is valid, the
 * handler is correct, and the CSS class is right. Only the position in the
 * tree is wrong.
 *
 * Radix-based overlays (Dialog, Sheet, Popover, DropdownMenu) portal
 * themselves, which is why the notification bell and the user menu were
 * never affected. This guard is for the hand-rolled ones.
 *
 * Same family as translation-keys.test.ts (K01): fix the code, never the
 * guard.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = join(WEB_ROOT, 'src', 'components');
const HEADER = join(COMPONENTS, 'site-header.tsx');

/**
 * Does this source render a full-viewport overlay without portalling it?
 *
 * Both halves matter: the import proves `createPortal` is in scope, and the
 * call proves it is used. Checking only for the name would pass a file that
 * merely mentions it in a comment — which is exactly how the first draft of
 * this guard failed to catch its own bug.
 */
export function rendersUnportalledOverlay(source: string): boolean {
  const hasFixedOverlay = /className="[^"]*\bfixed inset-0\b/.test(source);
  if (!hasFixedOverlay) return false;
  const imports = /import\s+\{[^}]*\bcreatePortal\b[^}]*\}\s+from\s+'react-dom'/.test(source);
  const calls = /\bcreatePortal\s*\(/.test(source);
  return !(imports && calls);
}

/** Local component files the header renders, one level deep. */
function headerChildren(): string[] {
  const source = readFileSync(HEADER, 'utf8');
  const out: string[] = [HEADER];
  for (const m of source.matchAll(/^import\s+\{[^}]*\}\s+from\s+'(\.\/[^']+)';$/gm)) {
    const rel = m[1];
    if (rel === undefined) continue;
    // Skip the ui/ primitives: those are Radix wrappers, which portal.
    if (rel.startsWith('./ui/')) continue;
    out.push(join(COMPONENTS, `${rel.slice(2)}.tsx`));
  }
  return out;
}

describe('header overlays', () => {
  it('HDR-P01: a fixed-inset overlay under the header is portalled to the body', () => {
    const offenders: string[] = [];

    for (const file of headerChildren()) {
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue; // A directory-style import or a .ts module — not our case.
      }
      if (rendersUnportalledOverlay(source)) offenders.push(file.slice(WEB_ROOT.length + 1));
    }

    expect(offenders).toEqual([]);
  });

  it('HDR-P01: the rule catches the shape the bug actually had', () => {
    // The overlay as it shipped: correct markup, correct handler, wrong
    // place in the tree.
    const broken = `
      export function Thing() {
        return open ? (
          <div className="fixed inset-0 z-50 bg-black/50" onClick={close} />
        ) : null;
      }`;
    expect(rendersUnportalledOverlay(broken)).toBe(true);

    // Mentioning the name is not using it — the first draft of this guard
    // passed a file in exactly this state.
    expect(rendersUnportalledOverlay(`${broken}\n// TODO: wrap this in createPortal one day`)).toBe(
      true,
    );

    const fixed = `
      import { createPortal } from 'react-dom';
      export function Thing() {
        return open
          ? createPortal(<div className="fixed inset-0 z-50 bg-black/50" />, document.body)
          : null;
      }`;
    expect(rendersUnportalledOverlay(fixed)).toBe(false);

    // A component with no full-viewport overlay is simply out of scope.
    expect(rendersUnportalledOverlay('<div className="absolute right-0" />')).toBe(false);
  });

  it('HDR-P01: the header still is the backdrop-filtered ancestor this guards against', () => {
    // If the header ever loses `backdrop-blur`, the rule above stops being
    // load-bearing and this test should be re-read rather than silently
    // guarding nothing.
    expect(readFileSync(HEADER, 'utf8')).toMatch(/backdrop-blur/);
  });
});
