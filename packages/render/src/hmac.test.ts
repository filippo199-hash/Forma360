/**
 * Unit tests for the render-token HMAC primitives.
 *
 * Covers: round-trip, expiry, forgery, inspection-id mismatch, garbage
 * input. No DB — pure crypto.
 */
import { describe, expect, it } from 'vitest';
import { signRenderToken, verifyRenderToken, DEFAULT_RENDER_TOKEN_TTL_SECONDS } from './hmac';

const SECRET = 'a'.repeat(32);

describe('render-token HMAC', () => {
  it('round-trips a freshly-signed token', () => {
    const token = signRenderToken({ secret: SECRET, inspectionId: 'INS' + '0'.repeat(23) });
    expect(
      verifyRenderToken({ secret: SECRET, inspectionId: 'INS' + '0'.repeat(23), token }),
    ).toBe(true);
  });

  it('rejects an expired token', () => {
    const past = new Date(Date.now() - 1_000_000);
    const token = signRenderToken({
      secret: SECRET,
      inspectionId: 'INS' + '0'.repeat(23),
      ttlSeconds: 10,
      now: past,
    });
    expect(
      verifyRenderToken({ secret: SECRET, inspectionId: 'INS' + '0'.repeat(23), token }),
    ).toBe(false);
  });

  it('rejects a token signed for a different inspection', () => {
    const token = signRenderToken({
      secret: SECRET,
      inspectionId: 'INS' + '0'.repeat(23),
    });
    expect(
      verifyRenderToken({
        secret: SECRET,
        inspectionId: 'INS' + '1'.repeat(23),
        token,
      }),
    ).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signRenderToken({
      secret: 'a'.repeat(32),
      inspectionId: 'INS' + '0'.repeat(23),
    });
    expect(
      verifyRenderToken({
        secret: 'b'.repeat(32),
        inspectionId: 'INS' + '0'.repeat(23),
        token,
      }),
    ).toBe(false);
  });

  it('rejects garbage tokens', () => {
    for (const bogus of ['', 'nodot', 'a.b.c', '.', 'x.y']) {
      expect(
        verifyRenderToken({
          secret: SECRET,
          inspectionId: 'INS' + '0'.repeat(23),
          token: bogus,
        }),
      ).toBe(false);
    }
  });

  it('uses a 5-minute default TTL', () => {
    expect(DEFAULT_RENDER_TOKEN_TTL_SECONDS).toBe(300);
  });
});
