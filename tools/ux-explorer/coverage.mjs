#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates docs/reviews/ux-walkthrough-coverage.md — the master route
 * ledger for the walkthrough programme (docs/ux-walkthrough-playbook.md
 * §8). Scans apps/web/app for page.tsx files, so a route added next month
 * appears the next time this runs; regenerate rather than hand-editing
 * rows, and keep the "Seen in" column's entries when regenerating by
 * re-applying them from the previous version (the script preserves them
 * automatically when the old file is present).
 *
 * Usage: node tools/ux-explorer/coverage.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = join(repoRoot, 'apps', 'web', 'app');
const outFile = join(repoRoot, 'docs', 'reviews', 'ux-walkthrough-coverage.md');

function collectPages(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...collectPages(join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
  return out;
}

const routes = collectPages(appDir).sort();

function classify(route) {
  if (route.startsWith('/render/')) return { group: 'render-internal (SWP-F)', module: 'render' };
  if (route.startsWith('/[locale]')) {
    const rest = route.replace('/[locale]', '');
    const seg = rest.split('/')[1] ?? '';
    return { group: 'in-app', module: seg === '' ? '(home)' : seg };
  }
  return { group: 'public / unlocalised', module: route.split('/')[1] ?? '(root)' };
}

// Preserve any ledger entries already recorded in a previous generation.
const previous = new Map();
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, 'utf8').split('\n')) {
    const m = line.match(/^\| `([^`]+)` \| (.*) \|$/);
    if (m !== null && m[2].trim() !== '') previous.set(m[1], m[2].trim());
  }
}

const classified = routes.map((route) => ({ route, ...classify(route) }));
const groups = ['in-app', 'public / unlocalised', 'render-internal (SWP-F)'];

let md = `# UX walkthrough coverage ledger

**Generated** by \`tools/ux-explorer/coverage.mjs\` — regenerate after route
changes (existing "Seen in" entries are preserved). ${classified.length} routes.

Each pass's findings doc ends with its route ledger; this file is the union.
Record a pass in "Seen in" as \`UXW-1(W1)\` / \`SWP-B\` etc. The first cycle's
exit criterion (playbook §8): every in-app route seen at least once, every
register also seen at zero rows and on /it, every render route opened once.
`;

for (const group of groups) {
  const rows = classified.filter((r) => r.group === group);
  if (rows.length === 0) continue;
  md += `\n## ${group} (${rows.length})\n\n| Route | Seen in |\n| --- | --- |\n`;
  let lastModule = null;
  for (const r of rows) {
    if (r.module !== lastModule && group === 'in-app') {
      lastModule = r.module;
      md += `| **${r.module}** | |\n`;
    }
    md += `| \`${r.route}\` | ${previous.get(r.route) ?? ''} |\n`;
  }
}

writeFileSync(outFile, md);
console.log(`wrote ${outFile.replace(`${repoRoot}${sep}`, '')} (${classified.length} routes)`);
