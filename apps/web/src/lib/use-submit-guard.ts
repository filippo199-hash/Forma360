'use client';

/**
 * One tap, one record.
 *
 * `disabled={mutation.isPending}` looks like a double-submit guard and is
 * not one. `isPending` only reaches the DOM after React re-renders, and a
 * burst of taps all land before that: three taps on the incident form
 * produced three incidents — IN-000001, IN-000002 and IN-000003 — each
 * with its own reference number in a statutory register, and the reporter
 * was told nothing (SWPD-03, found by error injection). The observation
 * form did the same.
 *
 * A ref flips synchronously, which is the only thing that closes the
 * window. This is the BUG-12 discipline applied to submission: current
 * state comes from a ref, never from the render closure.
 *
 *     const guard = useSubmitGuard();
 *     <Button onClick={() => guard.run(submit)} disabled={m.isPending}>
 *
 * or, for a handler that awaits:
 *
 *     async function onSubmit(e) {
 *       e.preventDefault();
 *       await guard.runAsync(async () => { … });
 *     }
 *
 * Keep the `disabled={isPending}` too — it is what makes the button LOOK
 * busy, which is the half of the job the ref cannot do. And note what this
 * deliberately does not touch: the input boxes stay enabled throughout,
 * because disabling a focused field blurs it and swallows what is being
 * typed (NR-01).
 *
 * For a `mutate` (not `mutateAsync`) call site, release it from the
 * mutation's own `onSettled`, so a failed write can be retried:
 *
 *     const m = trpc.x.create.useMutation({ onSettled: guard.release });
 *
 * **Then `take()` immediately before the mutation call, after every
 * validation return.** A `take()` at the top of the handler is stranded by
 * any early return that does not fire the mutation, and a stranded latch
 * is a dead button for the rest of the session — worse than the
 * double-submit it was added to prevent. This pass shipped that bug into
 * seven forms before catching it, including the incident form's
 * offline branch, which returns early by design. Where an early return
 * genuinely has to come after `take()`, call `release()` on that path.
 */
import { useCallback, useRef } from 'react';

export interface SubmitGuard {
  /** Run `fn` unless a submission is already in flight. Sync handlers. */
  run: (fn: () => void) => void;
  /** Await `fn`, releasing the latch when it settles. Async handlers. */
  runAsync: (fn: () => Promise<void>) => Promise<void>;
  /** Release the latch by hand — pair with a `mutate` call's `onSettled`. */
  release: () => void;
  /** Take the latch by hand, for a `mutate` whose release is elsewhere. */
  take: () => boolean;
}

export function useSubmitGuard(): SubmitGuard {
  const inFlight = useRef(false);

  const release = useCallback(() => {
    inFlight.current = false;
  }, []);

  const take = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true;
    return true;
  }, []);

  const run = useCallback(
    (fn: () => void) => {
      if (!take()) return;
      // A synchronous handler that fires `mutate` releases via onSettled;
      // one that throws must not leave the button latched forever.
      try {
        fn();
      } catch (err) {
        release();
        throw err;
      }
    },
    [take, release],
  );

  const runAsync = useCallback(
    async (fn: () => Promise<void>) => {
      if (!take()) return;
      try {
        await fn();
      } finally {
        release();
      }
    },
    [take, release],
  );

  return { run, runAsync, release, take };
}
