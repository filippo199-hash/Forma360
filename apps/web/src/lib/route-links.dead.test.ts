/**
 * SWP-A — every locale link in the app points at a route that exists.
 *
 * The RS-A1 class has now shipped twice: the RAMS pack page linked to a
 * `/build` route that had been written and never committed, which made
 * the module unable to produce its one deliverable; and the fire-safety
 * settings page shipped unreachable. Both were single missing files
 * behind a link that looked perfectly ordinary in review. The repo's own
 * bar for pinning a class is two occurrences, so this is that pin.
 *
 * It scrapes literal `/${locale}/…` template hrefs out of the web app and
 * checks each against the App Router tree, treating `[param]` segments as
 * wildcards and `[...rest]` as catch-alls. Links assembled from variables
 * are invisible to it by construction — the same limit K01 has — so this
 * is a floor, not a ceiling.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = join(__dirname, '..', '..');
const APP_DIR = join(WEB_ROOT, 'app');
const LOCALE_DIR = join(APP_DIR, '[locale]');

/** Every directory under a root that contains a `page.tsx`, as segment lists. */
function collectRoutes(root: string, prefix: string[] = []): string[][] {
  const routes: string[][] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return routes;
  }
  if (entries.includes('page.tsx')) routes.push(prefix);
  for (const entry of entries) {
    const full = join(root, entry);
    if (!statSync(full).isDirectory()) continue;
    // Route groups `(marketing)` do not appear in the URL.
    if (entry.startsWith('(') && entry.endsWith(')')) {
      routes.push(...collectRoutes(full, prefix));
      continue;
    }
    routes.push(...collectRoutes(full, [...prefix, entry]));
  }
  return routes;
}

/**
 * An interpolated href segment (`${tab}`, `${category}`) is a VALUE, and
 * values are just as often a static route name as a record id —
 * `/settings/${tab.key}` resolves to `/settings/profile`. So it matches
 * any route segment, dynamic or literal. Treating it as "must be a
 * [dynamic] segment" produced three false positives on the first run,
 * and a guard that cries wolf gets deleted (the hazard-library lesson).
 * What survives is the RS-A1 shape: a link whose LITERAL segments have
 * no page behind them, which is exactly how `/rams/[packId]/build`
 * shipped as a link to nowhere.
 */
const WILDCARD = ' param';

function matches(route: string[], target: string[]): boolean {
  for (let i = 0; i < route.length; i += 1) {
    const seg = route[i];
    if (seg === undefined) return false;
    // Catch-all swallows the remainder.
    if (seg.startsWith('[...') || seg.startsWith('[[...')) return true;
    if (i >= target.length) return false;
    if (target[i] === WILDCARD) continue; // an interpolated value
    if (seg.startsWith('[') && seg.endsWith(']')) continue; // dynamic route segment
    if (seg !== target[i]) return false;
  }
  return route.length === target.length;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('locale links resolve to real routes (SWP-A)', () => {
  it('every literal /${locale}/… href has a page behind it', () => {
    const routes = collectRoutes(LOCALE_DIR);
    expect(routes.length).toBeGreaterThan(20);

    const files = [...sourceFiles(APP_DIR), ...sourceFiles(join(WEB_ROOT, 'src'))];
    // `href={`/${locale}/permits/${id}/edit`}` and the `/${locale}` root.
    const hrefPattern = /`\/\$\{locale\}(\/[^`]*)?`/g;
    const dead: string[] = [];

    for (const file of files) {
      // Doc comments carry usage examples with invented paths
      // (`backHref={`/${locale}/things`}`), which are not links. Block
      // comments go entirely; line comments only when they own the line,
      // so a trailing `https://…` cannot swallow real code after it.
      const text = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      for (const match of text.matchAll(hrefPattern)) {
        const raw = match[1] ?? '';
        // Drop query strings and hashes — routing ignores them.
        const path = raw.split('?')[0]?.split('#')[0] ?? '';
        const segments = path
          .split('/')
          .filter((s) => s.length > 0)
          // A `${…}` interpolation is a value, matching any dynamic segment.
          .map((s) => (s.includes('${') ? WILDCARD : s));
        if (segments.length === 0) continue; // `/${locale}` — the app root
        if (segments.some((s) => s.includes('${'))) continue; // partial interpolation
        if (!routes.some((r) => matches(r, segments))) {
          dead.push(`${file.slice(WEB_ROOT.length + 1)} → /${segments.join('/')}`);
        }
      }
    }

    expect({ deadLinks: [...new Set(dead)].sort() }).toEqual({ deadLinks: [] });
  });
});
