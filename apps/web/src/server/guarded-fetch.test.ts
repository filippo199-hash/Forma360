/**
 * The pinned DNS lookup's contract (GF-E01/E02).
 *
 * This is worth a test of its own because getting it wrong is invisible
 * everywhere except at runtime, inside undici, as `UND_ERR_INVALID_ARG` —
 * and that is exactly what happened: every "Derive palette from website"
 * failed from the day it shipped, and the error looked like a network
 * problem, so the site got the blame.
 *
 * Node's `net.connect` calls a custom lookup with `{ all: true }` whenever
 * Happy Eyeballs is on (the default since Node 20) and then requires an
 * ARRAY of `{ address, family }`. The single `(address, family)` form is
 * only valid when `all` is false. undici's own internal lookup branches on
 * the same flag — see `undici/lib/core/connect.js`.
 */
import { describe, expect, it } from 'vitest';
import { pinnedLookup } from './guarded-fetch';

const ADDR = { address: '203.0.113.7', family: 4 };

describe('pinnedLookup', () => {
  it('GF-E01: answers with an array when the caller asks for all addresses', () => {
    let result: unknown;
    pinnedLookup(ADDR)('example.com', { all: true }, (err, address) => {
      expect(err).toBeNull();
      result = address;
    });
    expect(result).toEqual([{ address: '203.0.113.7', family: 4 }]);
  });

  it('GF-E02: answers with the address/family pair when it does not', () => {
    const seen: unknown[] = [];
    pinnedLookup(ADDR)('example.com', {}, (err, address, family) => {
      expect(err).toBeNull();
      seen.push(address, family);
    });
    expect(seen).toEqual(['203.0.113.7', 4]);

    // `undefined` options is the same case, not a third one.
    const bare: unknown[] = [];
    pinnedLookup(ADDR)('example.com', undefined, (_e, address, family) => {
      bare.push(address, family);
    });
    expect(bare).toEqual(['203.0.113.7', 4]);
  });

  it('GF-E03: pins the address it was given, never the hostname', () => {
    // The whole point of pinning: the hostname is preserved for TLS, but
    // the socket must go to the address the SSRF guard already validated.
    let out: unknown;
    pinnedLookup({ address: '198.51.100.9', family: 4 })(
      'attacker-controlled.example',
      { all: true },
      (_e, address) => {
        out = address;
      },
    );
    expect(out).toEqual([{ address: '198.51.100.9', family: 4 }]);
  });
});
