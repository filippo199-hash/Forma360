/**
 * RL-K01 — the rate-limit key must not be chosen by the caller.
 */
import { describe, expect, it } from 'vitest';
import { resolveClientIp, UNKNOWN_CLIENT_IP } from './client-ip';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

describe('resolveClientIp (RL-K01)', () => {
  it('takes the rightmost forwarded hop — the one our own edge wrote', () => {
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.4, 192.0.2.9' })),
    ).toBe('192.0.2.9');
  });

  it('a forged leading hop cannot become the key', () => {
    // The attack: send whatever you like in the header. The proxy appends
    // the address it actually saw, so the real hop is on the right.
    const forged = 'not-a-real-ip-i-rotate-per-request';
    const resolved = resolveClientIp(headers({ 'x-forwarded-for': `${forged}, 192.0.2.9` }));
    expect(resolved).toBe('192.0.2.9');
    expect(resolved).not.toBe(forged);
  });

  it('a single hop is the direct caller', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': '192.0.2.9' }))).toBe('192.0.2.9');
  });

  it('tolerates padding and empty entries', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': ' 203.0.113.7 ,  , 192.0.2.9 , ' }))).toBe(
      '192.0.2.9',
    );
  });

  it('falls back to x-real-ip only when there is no forwarded-for', () => {
    expect(resolveClientIp(headers({ 'x-real-ip': '192.0.2.9' }))).toBe('192.0.2.9');
    // Forwarded-for wins when both are present: it is the one with an end
    // we can reason about.
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': 'a, 192.0.2.9', 'x-real-ip': '203.0.113.7' })),
    ).toBe('192.0.2.9');
  });

  it('never returns an empty key', () => {
    // An empty string would collapse every anonymous caller onto one
    // bucket — or, worse, onto a key that looks distinct in a log.
    expect(resolveClientIp(headers({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp(headers({ 'x-forwarded-for': '' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp(headers({ 'x-forwarded-for': ' , , ' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp(headers({ 'x-real-ip': '   ' }))).toBe(UNKNOWN_CLIENT_IP);
  });
});
