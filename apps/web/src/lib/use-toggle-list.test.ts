/**
 * BUG-13(A): rapid toggles must accumulate, not race.
 *
 * Five synchronous clicks against a server value that never updates used to
 * produce five whole-array PATCHes each carrying only its own toggle — last
 * write wins, one of five kept. The hook's draft accumulates through a ref,
 * so the Nth patch carries all N toggles.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useToggleList } from './use-toggle-list';

describe('useToggleList (BUG-13)', () => {
  it('five rapid toggles: the fifth patch carries all five values', () => {
    const patch = vi.fn();
    const { result } = renderHook(() => useToggleList({ key: 'a1', serverValue: [], patch }));

    act(() => {
      for (const v of ['inhalation', 'skin', 'eyes', 'ingestion', 'injection']) {
        result.current.toggle(v);
      }
    });

    expect(patch).toHaveBeenCalledTimes(5);
    expect(patch.mock.calls[4]?.[0]).toEqual([
      'inhalation',
      'skin',
      'eyes',
      'ingestion',
      'injection',
    ]);
    expect(result.current.shown).toEqual(['inhalation', 'skin', 'eyes', 'ingestion', 'injection']);
  });

  it('toggling an accumulated value off removes it from the next patch', () => {
    const patch = vi.fn();
    const { result } = renderHook(() => useToggleList({ key: 'a1', serverValue: ['skin'], patch }));

    act(() => {
      result.current.toggle('inhalation');
      result.current.toggle('skin');
    });

    expect(patch.mock.calls[0]?.[0]).toEqual(['skin', 'inhalation']);
    expect(patch.mock.calls[1]?.[0]).toEqual(['inhalation']);
    expect(result.current.shown).toEqual(['inhalation']);
  });

  it('prunes the draft once the server value catches up', () => {
    const patch = vi.fn();
    const { result, rerender } = renderHook(
      ({ serverValue }: { serverValue: string[] }) =>
        useToggleList({ key: 'a1', serverValue, patch }),
      { initialProps: { serverValue: [] as string[] } },
    );

    act(() => {
      result.current.toggle('inhalation');
    });
    // Server still stale: draft wins.
    rerender({ serverValue: [] });
    expect(result.current.shown).toEqual(['inhalation']);

    // Refetch landed: draft prunes, server value is truth again.
    rerender({ serverValue: ['inhalation'] });
    expect(result.current.shown).toEqual(['inhalation']);
    act(() => {
      result.current.toggle('skin');
    });
    expect(patch.mock.calls[1]?.[0]).toEqual(['inhalation', 'skin']);
  });

  it('a stale draft never leaks across records: key change resets it', () => {
    const patch = vi.fn();
    const { result, rerender } = renderHook(
      ({ key, serverValue }: { key: string; serverValue: string[] }) =>
        useToggleList({ key, serverValue, patch }),
      { initialProps: { key: 'a1', serverValue: [] as string[] } },
    );

    act(() => {
      result.current.toggle('inhalation');
    });
    rerender({ key: 'a2', serverValue: ['eyes'] });
    expect(result.current.shown).toEqual(['eyes']);
  });
});
