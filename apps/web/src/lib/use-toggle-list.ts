'use client';

/**
 * Local-draft toggling for a server-persisted string array (BUG-13).
 *
 * The COSHH exposure chips patched the WHOLE array computed from the
 * react-query cache (staleTime 30s), so five fast clicks all derived from
 * the same pre-write base and each request carried only its own toggle —
 * last write wins, one of five kept. This is the stale-base sibling of the
 * BUG-12 stale-closure class CLAUDE.md documents.
 *
 * The fix: accumulate toggles in a local draft read through a ref (never a
 * render closure), so every patch carries ALL toggles so far and the final
 * write is complete regardless of request ordering. The draft prunes itself
 * once the server value catches up, and resets when `key` (the record id)
 * changes.
 */
import { useEffect, useRef, useState } from 'react';

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function useToggleList({
  key,
  serverValue,
  patch,
}: {
  /** Identity of the record the list belongs to — draft resets on change. */
  key: string;
  serverValue: readonly string[];
  /** Fired once per toggle with the complete accumulated next value. */
  patch: (next: string[]) => void;
}): { shown: readonly string[]; toggle: (value: string) => void } {
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  // The ref is the accumulation base: state updates are async, so a second
  // click landing before the first re-render must still see the first
  // click's result.
  const draftRef = useRef<readonly string[] | null>(null);
  const serverRef = useRef(serverValue);
  serverRef.current = serverValue;

  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      draftRef.current = null;
      setDraft(null);
    }
  }, [key]);

  // Prune the draft once the refetched server value agrees with it — from
  // then on the server row is the source of truth again.
  useEffect(() => {
    if (draftRef.current !== null && sameList(serverValue, draftRef.current)) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [serverValue]);

  function toggle(value: string): void {
    const base = draftRef.current ?? serverRef.current;
    const next = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
    draftRef.current = next;
    setDraft(next);
    patch([...next]);
  }

  return { shown: draft ?? serverValue, toggle };
}
