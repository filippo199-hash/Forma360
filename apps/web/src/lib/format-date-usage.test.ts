/**
 * Every date shown to a user goes through format-date.ts (UK-DATES).
 *
 * The shipped failure: pages hand-rolled `toLocaleDateString(locale)` with
 * the bare next-intl segment — ICU resolves 'en' to en-US, so PEEP/marshal
 * cards printed "Aug 16, 2027" and a RIDDOR due date read month-first to
 * the person whose 10-day clock depends on it. Five pages carried a local
 * `formatDate` helper that SHADOWED the shared one.
 *
 * This guard scrapes app/ + src/ for direct toLocale*String /
 * new Intl.DateTimeFormat calls and fails on any not on the allowlist:
 *   - lines routed through displayLocale(...) (calendar month/weekday
 *     labels that need formats the shared helpers don't offer),
 *   - explicit region-qualified literals ('en-GB' number/date formatting
 *     in print layouts and the company-settings preview),
 *   - Intl.DateTimeFormat().resolvedOptions().timeZone (not a display).
 *
 * Same family as translation-keys.test.ts (K01): fix the code, never the
 * guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_ROOTS = [join(WEB_ROOT, 'app'), join(WEB_ROOT, 'src')];

const OFFENDER = /toLocale(?:Date|Time)?String\(|new Intl\.DateTimeFormat\(/;

/** A matching line is fine when it is one of these known-legitimate shapes. */
const LINE_ALLOWLIST = [
  /displayLocale\(/, // routed through the shared locale mapping
  /'en-GB'/, // explicitly region-qualified (print layouts, settings preview)
  /resolvedOptions\(\)/, // timezone probing, not display formatting
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (
      (full.endsWith('.tsx') || full.endsWith('.ts')) &&
      !/\.test\.tsx?$/.test(full) &&
      !full.endsWith(join('lib', 'format-date.ts'))
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('date formatting goes through format-date.ts (UK-DATES)', () => {
  it('no hand-rolled toLocale*String / Intl.DateTimeFormat display calls', () => {
    const problems: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const lines = readFileSync(file, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          // Strip line comments so a comment DESCRIBING the old bug does
          // not trip the guard.
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (!OFFENDER.test(code)) return;
          if (LINE_ALLOWLIST.some((re) => re.test(line))) return;
          problems.push(`${relative(WEB_ROOT, file)}:${i + 1}  ${line.trim()}`);
        });
      }
    }

    expect({ handRolledDateCalls: problems.sort() }).toEqual({ handRolledDateCalls: [] });
  });
});
