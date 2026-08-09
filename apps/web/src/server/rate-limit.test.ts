/**
 * RL-F02 — the limiter's failure mode is now a per-call decision.
 *
 * The fail-open default was justified in the module comment on the premise
 * that "every gated endpoint is already authenticated/signature-checked".
 * That premise expired when the unauthenticated surface appeared, and
 * nothing re-examined it. These tests pin both halves of the resolution:
 * the default still degrades gracefully, and a caller that asks to fail
 * closed actually does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
}));

vi.mock('./redis', () => ({ redis: redisMock }));

const { rateLimit } = await import('./rate-limit');

describe('rateLimit (RL-F02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows under the limit and refuses over it', async () => {
    redisMock.incr.mockResolvedValueOnce(1);
    redisMock.expire.mockResolvedValueOnce(1);
    await expect(rateLimit('k', { limit: 2, windowSec: 60 })).resolves.toMatchObject({ ok: true });

    redisMock.incr.mockResolvedValueOnce(3);
    redisMock.ttl.mockResolvedValueOnce(42);
    await expect(rateLimit('k', { limit: 2, windowSec: 60 })).resolves.toMatchObject({
      ok: false,
      retryAfterSec: 42,
    });
  });

  it('fails OPEN by default when the store is unreachable', async () => {
    // Unchanged, and deliberately so: an authenticated endpoint should not
    // go down because Redis blinked.
    redisMock.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(rateLimit('k', { limit: 5, windowSec: 60 })).resolves.toMatchObject({ ok: true });
  });

  it('fails CLOSED when the caller asks, because it is the only brake', async () => {
    // `issues.createFromShareToken`, `auth.signUpWithTenant` and
    // `POST /api/sandbox/create` are unauthenticated writes. "Allow
    // everything while Redis is down" is an unbounded write path there,
    // not a graceful degradation.
    redisMock.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      rateLimit('k', { limit: 5, windowSec: 3600, failClosed: true }),
    ).resolves.toMatchObject({ ok: false, retryAfterSec: 3600 });
  });

  it('failClosed changes nothing while the store is healthy', async () => {
    redisMock.incr.mockResolvedValueOnce(1);
    redisMock.expire.mockResolvedValueOnce(1);
    await expect(
      rateLimit('k', { limit: 5, windowSec: 60, failClosed: true }),
    ).resolves.toMatchObject({ ok: true });
  });
});
