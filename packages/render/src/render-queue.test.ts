/**
 * RQ-E01..E04 — the render slot queue is bounded and cannot leak a slot.
 *
 * `RENDER_CONCURRENCY` capped how many Chromium pages ran at once but not how
 * many callers could queue behind them, and there was no timeout. Every export
 * route is an unthrottled `GET`, so a burst — or a cross-site navigation, which
 * `sameSite=lax` permits — parked request handlers indefinitely.
 *
 * The subtle failure these pin is slot LEAKAGE: if a waiter times out and is
 * later handed a slot anyway, `inFlightRenders` never comes back down and the
 * renderer wedges permanently after enough timeouts.
 */
import { describe, expect, it } from 'vitest';
import {
  RENDER_CONCURRENCY,
  RENDER_QUEUE_LIMIT,
  RENDER_QUEUE_TIMEOUT_MS,
  RenderQueueFullError,
  __renderSlotInternalsForTests as slots,
} from './pdf';

/** Take a slot and return its release function. */
async function take(): Promise<() => void> {
  await slots.acquire();
  return slots.release;
}

describe('render slot queue', () => {
  it('RQ-E01: the caps are sane relative to each other', () => {
    expect(RENDER_CONCURRENCY).toBeGreaterThan(0);
    expect(RENDER_QUEUE_LIMIT).toBeGreaterThan(RENDER_CONCURRENCY);
    expect(RENDER_QUEUE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('RQ-E02: admits up to RENDER_CONCURRENCY immediately, then queues', async () => {
    slots.reset();
    const held: Array<() => void> = [];
    for (let i = 0; i < RENDER_CONCURRENCY; i += 1) held.push(await take());
    expect(slots.inFlight()).toBe(RENDER_CONCURRENCY);

    // The next caller must wait rather than resolve.
    let resolved = false;
    const pending = slots.acquire().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(slots.waiting()).toBe(1);

    // Releasing hands the slot straight over; the count does not change.
    held[0]?.();
    await pending;
    expect(resolved).toBe(true);
    expect(slots.inFlight()).toBe(RENDER_CONCURRENCY);
  });

  it('RQ-E03: refuses once the queue is full instead of waiting forever', async () => {
    slots.reset();
    for (let i = 0; i < RENDER_CONCURRENCY; i += 1) await slots.acquire();
    // Fill the waiter queue to its cap. These stay pending for the test's life.
    const waiters = Array.from({ length: RENDER_QUEUE_LIMIT }, () =>
      slots.acquire().catch(() => undefined),
    );
    await Promise.resolve();
    expect(slots.waiting()).toBe(RENDER_QUEUE_LIMIT);

    await expect(slots.acquire()).rejects.toBeInstanceOf(RenderQueueFullError);
    void waiters;
  });

  it('RQ-E04: a timed-out waiter never leaks a slot', async () => {
    slots.reset();
    const release = await take();
    for (let i = 1; i < RENDER_CONCURRENCY; i += 1) await slots.acquire();

    // A waiter that gives up.
    const timedOut = slots.acquire();
    await Promise.resolve();
    expect(slots.waiting()).toBe(1);

    slots.expireAllWaitersForTests();
    await expect(timedOut).rejects.toBeInstanceOf(RenderQueueFullError);
    expect(slots.waiting()).toBe(0);

    // Now release the slot the abandoned waiter was queued behind. Because it
    // removed itself, the slot must return to the pool rather than being
    // handed to a dead waiter (which would pin inFlight at its ceiling).
    const before = slots.inFlight();
    release();
    expect(slots.inFlight()).toBe(before - 1);
  });
});
