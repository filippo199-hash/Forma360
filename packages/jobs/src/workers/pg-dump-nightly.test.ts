import { describe, expect, it } from 'vitest';
import { pgDumpSpawnError } from './pg-dump-nightly';

/**
 * FREEHS-4 — the nightly backup died every night with a bare
 * `Error: spawn pg_dump ENOENT`. The message named neither the cause (the
 * deployed worker image ships no PostgreSQL client binaries) nor the fix, so
 * the failure read as a code bug rather than the build-config bug it was.
 *
 * The image itself is fixed at the builder level. This guards the other half:
 * if `pg_dump` ever goes missing again, the error says so in words an operator
 * can act on instead of three letters of errno.
 */
describe('pgDumpSpawnError (FREEHS-4)', () => {
  it('turns an ENOENT spawn failure into an operator-actionable error', () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error('spawn pg_dump ENOENT'), {
      code: 'ENOENT',
    });

    const explained = pgDumpSpawnError(enoent);

    // Names what is wrong...
    expect(explained.message).toMatch(/pg_dump/);
    expect(explained.message).toMatch(/not on PATH/i);
    // ...and what to do about it: the ROOT nixpacks.toml is the file that is
    // actually read, which is the whole trap this error exists to short-circuit.
    expect(explained.message).toMatch(/postgresql_16/);
    expect(explained.message).toMatch(/root nixpacks\.toml/i);
    // The original errno is preserved for the stack trace in Sentry.
    expect(explained.cause).toBe(enoent);
  });

  it('passes a non-ENOENT spawn failure through untouched', () => {
    const eacces: NodeJS.ErrnoException = Object.assign(new Error('spawn pg_dump EACCES'), {
      code: 'EACCES',
    });

    expect(pgDumpSpawnError(eacces)).toBe(eacces);
  });
});
