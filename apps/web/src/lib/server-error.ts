/**
 * Turning a server refusal into something a person can act on.
 *
 * Every domain guard in `packages/api` throws a TRPCError whose `message` is
 * a stable kebab-case key — `lev-failed-examination-outstanding`,
 * `gas-test-stale`, `residual-above-initial`. Those keys are the product's
 * actual safety logic, and they are precise.
 *
 * The web layer was throwing all of that away. 105 call sites do
 *
 *     onError: () => toast.error(t('saveError'))
 *
 * which renders "Could not save. Try again." over a server that just said
 * exactly what was wrong and how to fix it. An HSE evaluation found four
 * separate "bugs" that were this one behaviour: a working LEV
 * return-to-service guard that looked like a broken button, a gas-test gate
 * whose refusal read as a glitch, a raw `conditions-required` key shown as
 * validation copy, and a 1,100-character paste rejected with no hint that
 * length was the problem.
 *
 * `serverErrorMessage` resolves the key against the `serverErrors` namespace
 * and falls back to the caller's generic string, so a call site can adopt it
 * with a one-line change and never regress to worse copy than it had.
 *
 * The catalogue is kept complete by `server-error.test.ts` (I18N-SE01), which
 * scrapes every `message: '…'` thrown across the API and fails if one has no
 * entry. A guard added tomorrow gets human copy or it does not ship.
 */

/** The shape next-intl's `useTranslations` hands back, narrowed to what we use. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** tRPC client errors carry the server `message` verbatim. */
export function serverErrorKey(err: unknown): string | null {
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object' && 'message' in err) {
    const raw = (err as { message?: unknown }).message;
    if (typeof raw === 'string') return raw;
  }
  return null;
}

/** True when `key` looks like one of our stable guard keys rather than prose. */
export function looksLikeGuardKey(key: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key) && key.length <= 64;
}

/**
 * Resolve a caught error to display copy.
 *
 * @param err       the error from a tRPC mutation/query
 * @param t         a `useTranslations('serverErrors')` binding
 * @param fallback  what to show when the key is unknown (keep the call site's
 *                  existing generic string here — never a raw key)
 */
export function serverErrorMessage(err: unknown, t: Translate, fallback: string): string {
  const key = serverErrorKey(err);
  if (key === null || !looksLikeGuardKey(key)) return fallback;
  // next-intl throws when a key is absent; a missing entry must degrade to the
  // caller's generic copy, never to the raw key on screen.
  try {
    const copy = t(key);
    // next-intl renders the key path when it cannot resolve — treat that as a miss.
    return copy.includes(key) && copy.length <= key.length + 20 ? fallback : copy;
  } catch {
    return fallback;
  }
}
