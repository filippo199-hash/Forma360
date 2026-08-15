/**
 * Message placeholders must match the arguments passed (I18N-P01/P02).
 *
 * `translation-keys.test.ts` proves a key RESOLVES. It does not look at what
 * the message needs. That gap shipped a raw key onto a published fire risk
 * assessment — a statutory document — and an HSE evaluation caught it in
 * production:
 *
 *     fireSafety.fra.reviewLine = "{date} — {trigger}, {outcome}"
 *     …called as  t('reviewLine', { last, next })
 *
 * The key existed, so K01 passed it. next-intl then threw FORMATTING_ERROR on
 * the missing `date` and fell back to rendering the key path, so the page
 * showed the literal string "fireSafety.fra.reviewLine" under the title.
 *
 * A missing key and a mismatched placeholder produce the SAME symptom for a
 * reader, so they deserve the same guard. P01 parses every literal
 * `t('key', { … })` call in the app and checks the message's `{placeholders}`
 * are exactly satisfied — nothing required-but-absent, nothing passed-but-
 * unused. P02 then checks every translated locale declares the same
 * placeholders as English, because a translator dropping `{count}` breaks
 * that locale only, silently, and nobody who speaks English will ever see it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MESSAGES_DIR = join(REPO_ROOT, 'packages', 'i18n', 'messages');
const SCAN_ROOTS = [join(REPO_ROOT, 'apps', 'web', 'app')];

type Bundle = { [key: string]: string | Bundle };

function loadBundle(locale: string): Bundle {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8')) as Bundle;
}

function resolveKey(bundle: Bundle, path: string): string | null {
  let node: string | Bundle | undefined = bundle;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

/**
 * The argument names a caller must supply for an ICU message.
 *
 * This walks the braces rather than pattern-matching them, because a regex
 * cannot tell an argument from a plural option body. In
 *
 *     {count, plural, one {was} other {were}}
 *
 * the only argument is `count`; `was` and `were` are literal option labels. A
 * naive scan reports all three, which makes every translated locale look like
 * it has drifted — a false alarm that would get this guard deleted.
 */
function placeholdersOf(message: string): Set<string> {
  const out = new Set<string>();
  let i = 0;
  while (i < message.length) {
    if (message[i] !== '{') {
      i += 1;
      continue;
    }
    // Read the argument name up to ',' or '}'.
    let j = i + 1;
    while (j < message.length && message[j] !== ',' && message[j] !== '}') j += 1;
    const name = message.slice(i + 1, j).trim();
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) out.add(name);
    // Find the brace that closes THIS argument, counting from the opening one
    // so a simple `{from}` terminates at its own `}` rather than running on.
    let depth = 0;
    let k = i;
    while (k < message.length) {
      if (message[k] === '{') depth += 1;
      else if (message[k] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      k += 1;
    }
    // For a typed argument (`plural` / `select` / `selectordinal`) the braces
    // inside are OPTION BODIES — `one {was}` — not arguments. Their CONTENTS
    // can still hold real nested arguments (`other {# of {total}}`), so step
    // through each option body and scan what is inside it.
    const body = message.slice(j, k);
    if (/^\s*,\s*(?:plural|select|selectordinal)\b/.test(body)) {
      let b = 0;
      while (b < body.length) {
        if (body[b] !== '{') {
          b += 1;
          continue;
        }
        let d = 1;
        let e = b;
        while (e < body.length && d > 0) {
          e += 1;
          if (body[e] === '{') d += 1;
          else if (body[e] === '}') d -= 1;
        }
        for (const n of placeholdersOf(body.slice(b + 1, e))) out.add(n);
        b = e + 1;
      }
    }
    i = k + 1;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Call {
  file: string;
  namespaces: string[];
  key: string;
  args: string[];
}

/**
 * Find `const X = useTranslations('ns')` bindings, then every
 * `X('key', { a, b })` call against them. Only literal keys with a literal
 * object argument are considered — anything dynamic is out of scope here and
 * is covered by the pinned K02-style tests.
 */
function literalCallsWithArgs(file: string): Call[] {
  const src = readFileSync(file, 'utf-8');
  const bindings = new Map<string, string>();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)) {
    const name = m[1];
    const ns = m[2];
    if (name !== undefined && ns !== undefined) bindings.set(name, ns);
  }
  if (bindings.size === 0) return [];

  const calls: Call[] = [];
  for (const [name, ns] of bindings) {
    const re = new RegExp(`(?<![\\w.])${name}\\(\\s*'([^']+)'\\s*,\\s*\\{([^{}]*)\\}\\s*\\)`, 'g');
    for (const m of src.matchAll(re)) {
      const key = m[1];
      const body = m[2] ?? '';
      if (key === undefined) continue;
      const args = [...body.matchAll(/(^|,)\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/g)]
        .map((a) => a[2])
        .filter((a): a is string => a !== undefined);
      // Shorthand `{ count }` as well as `{ count: n }`.
      for (const a of body.split(',')) {
        const bare = a.trim();
        if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(bare) && !args.includes(bare)) args.push(bare);
      }
      calls.push({ file, namespaces: [ns], key, args });
    }
  }
  return calls;
}

describe('translation placeholders', () => {
  it('I18N-P01 — every literal t(key, args) call satisfies the message exactly', () => {
    const en = loadBundle('en');
    const problems: string[] = [];
    let checked = 0;

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        for (const call of literalCallsWithArgs(file)) {
          const message = call.namespaces
            .map((ns) => resolveKey(en, `${ns}.${call.key}`))
            .find((v): v is string => v !== null);
          // A key that does not resolve is K01's job, not ours.
          if (message === undefined) continue;
          checked += 1;
          const needed = placeholdersOf(message);
          const given = new Set(call.args);
          const missing = [...needed].filter((n) => !given.has(n));
          const unused = [...given].filter((g) => !needed.has(g));
          if (missing.length > 0 || unused.length > 0) {
            problems.push(
              `${call.namespaces[0]}.${call.key} (${relative(REPO_ROOT, file)})` +
                (missing.length > 0 ? ` missing:[${missing.join(',')}]` : '') +
                (unused.length > 0 ? ` unused:[${unused.join(',')}]` : ''),
            );
          }
        }
      }
    }

    // If the scan stops finding calls, this test proves nothing.
    expect(checked).toBeGreaterThan(30);
    expect({ placeholderMismatches: problems.sort() }).toEqual({ placeholderMismatches: [] });
  });

  it('I18N-P02 — every locale declares the same placeholders as English', () => {
    const en = loadBundle('en');
    const locales = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'))
      .filter((l) => l !== 'en');

    const flat = (b: Bundle, prefix = '', out: Map<string, string> = new Map()) => {
      for (const [k, v] of Object.entries(b)) {
        const path = prefix === '' ? k : `${prefix}.${k}`;
        if (typeof v === 'string') out.set(path, v);
        else flat(v, path, out);
      }
      return out;
    };
    const enFlat = flat(en);
    const drift: string[] = [];

    for (const locale of locales) {
      const other = flat(loadBundle(locale));
      for (const [path, enMsg] of enFlat) {
        const translated = other.get(path);
        // A key absent from a locale falls back to English — fine.
        if (translated === undefined) continue;
        const a = [...placeholdersOf(enMsg)].sort().join(',');
        const b = [...placeholdersOf(translated)].sort().join(',');
        if (a !== b) drift.push(`${locale}:${path}  en[${a}] vs ${locale}[${b}]`);
      }
    }
    expect({ placeholderDrift: drift.sort() }).toEqual({ placeholderDrift: [] });
  });
});
