/**
 * Rate-limit keying integrity (found by the cross-module sweep's XM-P axis).
 *
 * `ctx.clientIp` is the subject of five rate limits in this product, three of
 * which gate UNAUTHENTICATED writes:
 *
 *   auth:lookup:<ip>        20 / 60 s   cross-tenant account-existence oracle
 *   auth:signup:<ip>         5 / 3600 s anonymous tenant creation
 *   sandbox:claim:<ip>      10 / 3600 s
 *   sandbox:create:<ip>      5 / 3600 s anonymous seeded-tenant provisioning
 *   issue:qr:ip:<ip>        10 / 60 s   anonymous observation submission
 *
 * A rate limit is only as good as its key. If the caller chooses the key, the
 * limit is decorative: rotate the value per request and every window is a fresh
 * one.
 *
 * `X-Forwarded-For` is an append-only chain — each proxy APPENDS the peer it
 * saw, so the list reads `client, proxy1, proxy2` and the LEFTMOST entry is
 * whatever the original client sent. It is the one hop in the chain that no
 * infrastructure vouched for. The trustworthy hop is the RIGHTMOST, or better,
 * the value the platform sets itself.
 *
 * These tests describe CORRECT behaviour and fail today.
 */
import { describe, expect, it } from 'vitest';
import { createContextFactory } from './context';
import { createLogger } from '@forma360/shared/logger';

/**
 * Build a context the way the fetch adapter does, with no session — the
 * unauthenticated case every one of the five limits above is defending.
 */
async function clientIpFor(headers: Record<string, string>): Promise<string> {
  const factory = createContextFactory({
    db: {} as never,
    // No cookie, so `getSession` is never meaningfully consulted; it is
    // stubbed to the shape the factory calls.
    auth: { api: { getSession: async () => null } } as never,
    logger: createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' }),
  });
  const ctx = await factory({ headers: new Headers(headers) });
  return ctx.clientIp;
}

describe('rate-limit keying · clientIp', () => {
  it('RL-K01 · a client-supplied X-Forwarded-For entry is not used as the rate-limit subject', async () => {
    // The attack, in one line: send a different first hop each request.
    // Behind a proxy the real header arriving at the app is
    //   `<whatever the client sent>, <real peer>`
    // and taking `[0]` keys the limiter on the attacker's half.
    const spoofed = await clientIpFor({
      'x-forwarded-for': '10.0.0.99, 203.0.113.7',
    });

    // Whatever the correct answer is, it must not be the value the caller
    // chose. `203.0.113.7` here is the hop the edge appended.
    expect({ keyedOnCallerSuppliedValue: spoofed === '10.0.0.99' }).toEqual({
      keyedOnCallerSuppliedValue: false,
    });
  });

  it('RL-K02 · rotating the forged hop does not mint a fresh rate-limit window', async () => {
    // The consequence, stated as the property that actually matters: two
    // requests from the same real peer must land on the same limiter key,
    // however the caller decorates the header.
    const a = await clientIpFor({ 'x-forwarded-for': 'aaa.aaa.aaa.aaa, 203.0.113.7' });
    const b = await clientIpFor({ 'x-forwarded-for': 'bbb.bbb.bbb.bbb, 203.0.113.7' });

    expect({ sameRealPeerSameKey: a === b }).toEqual({ sameRealPeerSameKey: true });
  });

  it('RL-K03 · a single-hop header still resolves to that hop', async () => {
    // The control. Whatever the fix is, the ordinary case — one proxy, one
    // entry — must keep working, or every limit degrades to 'unknown' and
    // the whole product shares one bucket.
    const single = await clientIpFor({ 'x-forwarded-for': '203.0.113.7' });
    expect({ resolved: single }).toEqual({ resolved: '203.0.113.7' });
  });
});
