/**
 * The server-error catalogue must stay complete (I18N-SE01/SE02).
 *
 * Every domain guard in `packages/api` throws a TRPCError whose `message` is a
 * stable kebab-case key. `serverErrorMessage` renders those to people. A key
 * with no entry silently degrades to "Could not save. Try again." — which is
 * precisely the failure an HSE evaluation logged four times over, most sharply
 * on a working LEV return-to-service guard that read as a broken button.
 *
 * So the catalogue is not maintained by hand-discipline. SE01 scrapes every
 * thrown key out of the API and fails when one has no copy: a guard added
 * tomorrow gets a human sentence or it does not ship.
 *
 * SE02 is the other direction — copy for a key nothing throws is dead weight
 * that makes the catalogue look more complete than it is. It reports rather
 * than fails, because a key can legitimately be retired ahead of its copy.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { looksLikeGuardKey, serverErrorMessage, serverErrorKey } from './server-error';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MESSAGES = join(REPO_ROOT, 'packages', 'i18n', 'messages', 'en.json');
const API_SRC = join(REPO_ROOT, 'packages', 'api', 'src');
const SHARED_SRC = join(REPO_ROOT, 'packages', 'shared', 'src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__fixtures__') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every stable guard key thrown anywhere in the API or shared domain code. */
function thrownGuardKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of [...walkTs(API_SRC), ...walkTs(SHARED_SRC)]) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/message:\s*'([a-z][a-z0-9-]*)'/g)) {
      const key = m[1];
      if (key !== undefined && looksLikeGuardKey(key)) keys.add(key);
    }
  }
  return keys;
}

function catalogue(): Record<string, string> {
  const bundle = JSON.parse(readFileSync(MESSAGES, 'utf-8')) as {
    serverErrors?: Record<string, string>;
  };
  return bundle.serverErrors ?? {};
}

describe('server-error catalogue', () => {
  it('I18N-SE01 — every guard key the API throws has human copy', () => {
    const thrown = thrownGuardKeys();
    const have = catalogue();
    // Sanity: if the scrape stops finding keys, this test proves nothing.
    expect(thrown.size).toBeGreaterThan(150);
    const missing = [...thrown].filter((k) => !(k in have)).sort();
    expect({ keysWithoutCopy: missing }).toEqual({ keysWithoutCopy: [] });
  });

  it('I18N-SE02 — the copy reads as a sentence, not a restated key', () => {
    const have = catalogue();
    // A key's own words legitimately appear in its sentence — "archived"
    // belongs in "This record has been archived." What must not happen is the
    // key RESTATED as the copy ("Lev failed examination outstanding"), which
    // is what auto-generating from key names produces.
    const restatesKey = (key: string, copy: string): boolean =>
      copy
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim() === key.replace(/-/g, ' ');

    const bad = Object.entries(have)
      .filter(([key, copy]) => {
        if (copy.trim().length < 12) return true; // too short to be useful
        if (restatesKey(key, copy)) return true; // the key dressed up as prose
        return !/[.!?]$/.test(copy.trim()); // not a finished sentence
      })
      .map(([k]) => k)
      .sort();
    expect({ unusableCopy: bad }).toEqual({ unusableCopy: [] });
  });

  it('I18N-SE03 — resolution degrades to the caller fallback, never to a raw key', () => {
    const t = (key: string): string => {
      const copy = catalogue()[key];
      if (copy === undefined) throw new Error(`missing ${key}`);
      return copy;
    };
    const fallback = 'Could not save. Try again.';

    expect({
      // A known key resolves to its sentence.
      known: serverErrorMessage({ message: 'gas-test-stale' }, t, fallback),
      // An unknown key falls back rather than printing itself.
      unknown: serverErrorMessage({ message: 'not-a-real-guard-key-xyz' }, t, fallback),
      // Free prose from an unexpected error is never shown raw.
      prose: serverErrorMessage(new Error('Unexpected token < in JSON'), t, fallback),
      // A null-ish error still yields the fallback.
      empty: serverErrorMessage(null, t, fallback),
    }).toEqual({
      known: 'The latest gas test is too old. Take a fresh reading and try again.',
      unknown: fallback,
      prose: fallback,
      empty: fallback,
    });
  });

  it('I18N-SE04 — guard keys are recognised, prose is not', () => {
    expect({
      guard: looksLikeGuardKey('lev-failed-examination-outstanding'),
      prose: looksLikeGuardKey('Could not save. Try again.'),
      extracted: serverErrorKey({ message: 'window-past' }),
    }).toEqual({ guard: true, prose: false, extracted: 'window-past' });
  });
});
