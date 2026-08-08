/**
 * The degraded-export path (RF-E01..E06).
 *
 * A misconfigured object-store credential took out all six export
 * endpoints at once: the renderer produced a perfectly good PDF, the
 * cache write 403'd, and the route returned a 500 with raw JSON in a new
 * browser tab. The bytes existed the whole time. These tests pin the
 * holding area that now carries them to the response.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetRenderFallback, holdRenderedBytes, takeRenderedBytes } from './render-fallback';

const bytes = (n: number, fill = 1): Uint8Array => new Uint8Array(n).fill(fill);

describe('render fallback store', () => {
  beforeEach(() => __resetRenderFallback());

  it('RF-E01 — hands back exactly what was held', () => {
    holdRenderedBytes({ key: 'tenant/a.pdf', bytes: bytes(10, 7) });
    const got = takeRenderedBytes('tenant/a.pdf');
    expect(got).not.toBeNull();
    expect(got?.length).toBe(10);
    expect(got?.[0]).toBe(7);
  });

  it('RF-E02 — is single-use, so a second click re-renders rather than replaying', () => {
    holdRenderedBytes({ key: 'k', bytes: bytes(4) });
    expect(takeRenderedBytes('k')).not.toBeNull();
    expect(takeRenderedBytes('k')).toBeNull();
  });

  it('RF-E03 — returns null for a key that was never held', () => {
    expect(takeRenderedBytes('never-seen')).toBeNull();
  });

  it('RF-E04 — re-holding the same key replaces rather than double-counting', () => {
    holdRenderedBytes({ key: 'k', bytes: bytes(8, 1) });
    holdRenderedBytes({ key: 'k', bytes: bytes(8, 2) });
    expect(takeRenderedBytes('k')?.[0]).toBe(2);
    expect(takeRenderedBytes('k')).toBeNull();
  });

  it('RF-E05 — evicts oldest-first past the entry cap, so an outage cannot grow unbounded', () => {
    for (let i = 0; i < 40; i++) holdRenderedBytes({ key: `k${i}`, bytes: bytes(16) });
    // 32 is the cap; the earliest keys must be gone and the latest present.
    expect(takeRenderedBytes('k0')).toBeNull();
    expect(takeRenderedBytes('k39')).not.toBeNull();
  });

  it('RF-E06 — refuses a document larger than the whole budget rather than evicting everything', () => {
    holdRenderedBytes({ key: 'small', bytes: bytes(32) });
    holdRenderedBytes({ key: 'huge', bytes: bytes(64 * 1024 * 1024 + 1) });
    // The oversized one is not held...
    expect(takeRenderedBytes('huge')).toBeNull();
    // ...and it did not take the useful one down with it.
    expect(takeRenderedBytes('small')).not.toBeNull();
  });
});
