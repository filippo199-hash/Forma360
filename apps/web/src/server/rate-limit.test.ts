/**
 * Rate-limiter fail-open (found by the cross-module sweep's XM-P axis).
 *
 * The module comment on `rate-limit.ts` documents the fail-open as a
 * deliberate decision, and gives its justification:
 *
 *   > every gated endpoint is already authenticated/signature-checked, so
 *   > this is a spend/DoS control, not an authorization control.
 *
 * That was true when it was written. It is not true now. Since then the
 * product has grown endpoints whose ONLY brake is this limiter, with no
 * session, no signature and no account behind them:
 *
 *   issues.issues.createFromShareToken   anonymous observation write (QR code)
 *   auth.signUpWithTenant                anonymous tenant creation
 *   POST /api/sandbox/create             anonymous seeded-tenant provisioning
 *
 * So the finding is not "fail-open is wrong" — it is that the premise the
 * fail-open was justified on has expired, and nothing re-examined it when
 * the unauthenticated surface appeared.
 *
 * A limiter that returns `ok: true` on a backing-store error means a Redis
 * blip silently converts three anonymous write endpoints into unmetered
 * ones — and the incident looks like a Redis incident, not an abuse one.
 *
 * These tests describe CORRECT behaviour for the endpoints that now depend
 * on it. `RL-F02` is the one that fails today.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const incr = vi.fn();
const expire = vi.fn();
const ttl = vi.fn();

vi.mock('./redis', () => ({
  redis: {
    incr: (...a: unknown[]) => incr(...a),
    expire: (...a: unknown[]) => expire(...a),
    ttl: (...a: unknown[]) => ttl(...a),
  },
}));

const { rateLimit } = await import('./rate-limit');

describe('rate limiter · behaviour under a failing store', () => {
  beforeEach(() => {
    incr.mockReset();
    expire.mockReset();
    ttl.mockReset();
  });

  it('RL-F01 · control · a healthy store still allows and still refuses', async () => {
    incr.mockResolvedValueOnce(1);
    const first = await rateLimit('probe:healthy', { limit: 2, windowSec: 60 });

    incr.mockResolvedValueOnce(3);
    ttl.mockResolvedValueOnce(42);
    const overLimit = await rateLimit('probe:healthy', { limit: 2, windowSec: 60 });

    expect({ firstAllowed: first.ok, thirdRefused: overLimit.ok }).toEqual({
      firstAllowed: true,
      thirdRefused: false,
    });
  });

  it('RL-F02 · a store failure does not silently unmeter an anonymous write path', async () => {
    // Today: `catch { return { ok: true, … } }`. Every caller is told the
    // request is within its allowance, including the three endpoints above
    // that have no other control at all.
    //
    // The fix is not "fail closed everywhere" — that would take sign-up
    // down with Redis. It is to let the CALLER choose, so an endpoint
    // behind a session can keep failing open while an anonymous write
    // fails closed.
    incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await rateLimit('issue:qr:ip:203.0.113.7', {
      limit: 10,
      windowSec: 60,
      // The knob this test is asking for.
      failClosed: true,
    } as never);

    expect({ allowedDespiteStoreFailure: result.ok }).toEqual({
      allowedDespiteStoreFailure: false,
    });
  });
});
