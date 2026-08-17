/**
 * Guard: every queue name a router enqueues must be a registered queue.
 *
 * `Enqueue` in `packages/api/src/context.ts` is typed `(name: string, …)`
 * because `packages/api` cannot import `@forma360/jobs` — jobs already
 * imports api (notify, heads-up-publish, marshal-competence), so the
 * dependency would be a cycle. That leaves the name unchecked by tsc, and
 * the web layer's fire-and-forget wrapper swallows the failure into a log
 * line. Four call sites therefore spelled `forma360:<name>` where every
 * registered queue is `forma360-<name>`, and their jobs never ran: the
 * GDPR anonymisation cascade (sessions, 2FA rows, signature strokes) and
 * rule-based group + site membership reconciliation, silently, for the
 * whole life of the codebase.
 *
 * This test closes the class the only way available across a package
 * boundary tsc cannot span: read the routers off disk and compare the
 * literals against the registry. Queue names are compile-time literals at
 * every call site, so scraping is exact rather than heuristic.
 *
 * If this fails, fix the call site — never the assertion.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, QUEUE_PAYLOAD_SCHEMAS } from './queues';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** packages/jobs/src → packages/api/src */
const API_SRC = join(HERE, '..', '..', 'api', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `enqueue('name', …)` / `ctx.enqueue("name", …)` — the literal in group 2. */
const ENQUEUE_CALL = /\benqueue\(\s*(['"])([^'"]+)\1/g;

interface Call {
  readonly name: string;
  readonly file: string;
}

function scrapeEnqueueCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of walk(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ENQUEUE_CALL)) {
      const name = match[2];
      if (name !== undefined) {
        calls.push({ name, file: file.slice(API_SRC.length + 1) });
      }
    }
  }
  return calls;
}

describe('enqueue call sites (guard)', () => {
  const registered = new Set<string>(Object.values(QUEUE_NAMES));

  it('finds the enqueue call sites at all — a silent zero would pass vacuously', () => {
    expect(scrapeEnqueueCalls().length).toBeGreaterThanOrEqual(4);
  });

  it('every enqueued queue name is registered in QUEUE_NAMES', () => {
    const unknown = scrapeEnqueueCalls().filter((c) => !registered.has(c.name));
    expect(
      unknown,
      `Unregistered queue name(s) enqueued. Registered: ${[...registered].sort().join(', ')}`,
    ).toEqual([]);
  });

  it('every enqueued queue name has a payload schema', () => {
    const schemas = QUEUE_PAYLOAD_SCHEMAS as Record<string, unknown>;
    const missing = scrapeEnqueueCalls().filter((c) => schemas[c.name] === undefined);
    expect(missing).toEqual([]);
  });

  it('QUEUE_NAMES and QUEUE_PAYLOAD_SCHEMAS agree in both directions', () => {
    const schemaKeys = new Set(Object.keys(QUEUE_PAYLOAD_SCHEMAS));
    expect([...registered].filter((n) => !schemaKeys.has(n))).toEqual([]);
    expect([...schemaKeys].filter((n) => !registered.has(n))).toEqual([]);
  });

  it('no queue name uses a colon separator — the shape of the original bug', () => {
    const colonised = [...registered].filter((n) => n.includes(':'));
    expect(colonised).toEqual([]);
    const callsWithColon = scrapeEnqueueCalls().filter((c) => c.name.includes(':'));
    expect(callsWithColon).toEqual([]);
  });
});
