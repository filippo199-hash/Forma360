/**
 * The web server's logger runs pino, and pino resolves its transport worker
 * from its own directory on disk at runtime. Bundle it and that lookup
 * breaks: `thread-stream` computes `join(__dirname, 'lib', 'worker.js')`,
 * webpack rewrites `__dirname` to the emitted chunk directory, and the file
 * is not there. The worker exits, the logger's output goes with it, and the
 * process takes an uncaught exception at boot.
 *
 * That is not something a unit test of our own code can catch, because our
 * code is correct either way — the failure lives in the build config. So
 * this test reads the build config, the same scrape-the-source approach
 * `action-sources.test.ts` uses to keep a client table honest against its
 * server.
 *
 * Two conditions have to hold together, and one without the other still
 * breaks production:
 *   1. the package is externalised, so webpack emits a bare `require`;
 *   2. the package is declared here, so that `require` resolves — under
 *      pnpm, `apps/web/node_modules` only carries this package's own
 *      declared dependencies.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Packages the server logger reaches for at runtime. */
const LOGGER_RUNTIME_PACKAGES = ['pino', 'pino-pretty'] as const;

const webRoot = process.cwd();

function readServerExternalPackages(): string[] {
  const source = readFileSync(resolve(webRoot, 'next.config.ts'), 'utf8');
  const block = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(source);
  if (block?.[1] === undefined) {
    throw new Error('serverExternalPackages not found in next.config.ts');
  }
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

function readDeclaredDependencies(): Set<string> {
  const pkg: unknown = JSON.parse(readFileSync(resolve(webRoot, 'package.json'), 'utf8'));
  const { dependencies = {}, devDependencies = {} } = pkg as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);
}

describe('server logger runtime packages', () => {
  it.each(LOGGER_RUNTIME_PACKAGES)('externalises %s from the server bundle', (name) => {
    expect(readServerExternalPackages()).toContain(name);
  });

  it.each(LOGGER_RUNTIME_PACKAGES)('declares %s so Node can resolve it', (name) => {
    expect(readDeclaredDependencies().has(name)).toBe(true);
  });

  it('keeps the externals that were already load-bearing', () => {
    // puppeteer-core drags chromium glue in; pg / bullmq / ioredis have
    // native or worker-thread paths of their own. Losing any of them is the
    // same class of boot failure.
    expect(readServerExternalPackages()).toEqual(
      expect.arrayContaining(['pg', 'bullmq', 'ioredis', '@aws-sdk/client-s3', 'puppeteer-core']),
    );
  });
});
