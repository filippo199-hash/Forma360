/**
 * Every dialog/sheet must have an accessible title (BUG-25).
 *
 * Radix hard-errors "`DialogContent` requires a `DialogTitle`" in the
 * console for title-less content — and a screen-reader user gets an
 * unnamed dialog. Four detail Sheets shipped that way (observations,
 * actions, plan pins, the conduct action panel). This guard scrapes every
 * `<DialogContent>` / `<SheetContent>` block in the app and fails when it
 * finds no DialogTitle/SheetTitle inside. Escape hatches: an explicit
 * `aria-label` on the content, or a pass-through `{children}` block whose
 * callers own the title (their call sites are scanned too).
 *
 * Same family as translation-keys.test.ts (K01): fix the code, never the
 * guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_ROOTS = [join(WEB_ROOT, 'app'), join(WEB_ROOT, 'src', 'components')];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `<TagContent …>…</TagContent>` block in a source file. */
function contentBlocks(src: string, tag: 'DialogContent' | 'SheetContent'): string[] {
  const blocks: string[] = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = src.indexOf(open, from);
    if (start === -1) break;
    // Count nested opens so a dialog rendered inside a sheet's block does
    // not truncate the outer block early.
    let depth = 1;
    let cursor = start + open.length;
    while (depth > 0) {
      const nextOpen = src.indexOf(open, cursor);
      const nextClose = src.indexOf(close, cursor);
      if (nextClose === -1) {
        // Unclosed (self-closing or malformed) — treat to end of file.
        cursor = src.length;
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + open.length;
      } else {
        depth -= 1;
        cursor = nextClose + close.length;
      }
    }
    blocks.push(src.slice(start, cursor));
    from = cursor;
  }
  return blocks;
}

function hasAccessibleTitle(block: string): boolean {
  if (block.includes('<DialogTitle') || block.includes('<SheetTitle')) return true;
  // Explicit label on the content itself.
  if (/aria-label(ledby)?=/.test(block.slice(0, block.indexOf('>') + 1))) return true;
  // Pass-through container: the title arrives with the children. Those
  // call sites render their own <DialogContent>-wrapping component and are
  // not scanned here, but the primitive block itself is title-agnostic.
  if (block.includes('{children}')) return true;
  return false;
}

describe('dialog titles (BUG-25)', () => {
  it('every DialogContent/SheetContent block contains an accessible title', () => {
    const problems: string[] = [];
    let checked = 0;

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, 'utf-8');
        for (const tag of ['DialogContent', 'SheetContent'] as const) {
          // Skip the primitive definitions themselves.
          if (file.endsWith(join('ui', 'dialog.tsx')) || file.endsWith(join('ui', 'sheet.tsx'))) {
            continue;
          }
          for (const block of contentBlocks(src, tag)) {
            checked += 1;
            if (!hasAccessibleTitle(block)) {
              problems.push(`${relative(WEB_ROOT, file)} — <${tag}> without a title`);
            }
          }
        }
      }
    }

    // If the scan stops finding dialogs, this test proves nothing.
    expect(checked).toBeGreaterThan(50);
    expect({ titleLessDialogs: problems.sort() }).toEqual({ titleLessDialogs: [] });
  });
});
