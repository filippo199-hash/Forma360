/**
 * SWPD-03 — one tap, one record.
 *
 * The latch is the whole fix, so it is pinned directly rather than through
 * a component: `isPending` cannot be tested here because the bug is
 * precisely that `isPending` has not reached the DOM yet.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubmitGuard } from './use-submit-guard';

describe('useSubmitGuard (SWPD-03)', () => {
  it('a burst of synchronous taps fires the handler once', () => {
    const { result } = renderHook(() => useSubmitGuard());
    let fired = 0;
    act(() => {
      for (let i = 0; i < 5; i += 1) result.current.run(() => (fired += 1));
    });
    expect(fired).toBe(1);
  });

  it('releases so a genuine retry works — the point of onSettled', () => {
    const { result } = renderHook(() => useSubmitGuard());
    let fired = 0;
    act(() => {
      result.current.run(() => (fired += 1));
      result.current.release();
      result.current.run(() => (fired += 1));
    });
    expect(fired).toBe(2);
  });

  it('a throwing handler releases the latch rather than jamming the button', () => {
    const { result } = renderHook(() => useSubmitGuard());
    act(() => {
      expect(() =>
        result.current.run(() => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
    });
    let second = 0;
    act(() => {
      result.current.run(() => (second += 1));
    });
    expect(second).toBe(1);
  });

  it('runAsync holds the latch for the whole await and releases after', async () => {
    const { result } = renderHook(() => useSubmitGuard());
    let started = 0;
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });

    const first = result.current.runAsync(async () => {
      started += 1;
      await blocked;
    });
    // A second call while the first is in flight must not start.
    await result.current.runAsync(async () => {
      started += 1;
    });
    expect(started).toBe(1);

    release();
    await first;

    // …and once it has settled, the next submission is allowed.
    await result.current.runAsync(async () => {
      started += 1;
    });
    expect(started).toBe(2);
  });

  /**
   * The trap this pass shipped into seven forms before catching it: a
   * `take()` at the top of a handler, then a validation `return` that
   * never fires the mutation — so `onSettled` never runs, the latch is
   * never released, and the button is dead for the rest of the session.
   * Worse than the double-submit it was meant to prevent.
   */
  it('take() reports whether the latch was won, and stays taken until released', () => {
    const { result } = renderHook(() => useSubmitGuard());
    expect(result.current.take()).toBe(true);
    // Nothing releases it on its own — which is exactly why `take()` belongs
    // after every validation return, not at the top of the handler.
    expect(result.current.take()).toBe(false);
    // The escape hatch for a path that must return early anyway.
    result.current.release();
    expect(result.current.take()).toBe(true);
  });
});
