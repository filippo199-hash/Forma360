/**
 * Deep-link preservation across the login round-trip (S9.6).
 *
 * When an unauthenticated user hits a protected route, the module layouts
 * bounce them to the sign-in page. Without capturing where they were headed,
 * they land on a default page after login and lose the link they clicked
 * (an email notification, a shared inspection, a bookmark). These two pure
 * helpers thread the intended path through as a `?next=` query param.
 *
 * The read side (`safeNextPath`) is a security boundary: `next` arrives from
 * the URL and is attacker-controllable, so it must be validated to a local
 * same-origin path before any navigation — otherwise `?next=https://evil.com`
 * becomes an open redirect.
 */

/** Where sign-in sends a user who arrived without a specific destination. */
export const DEFAULT_SIGNED_IN_PATH = (locale: string): string => `/${locale}/templates`;

/**
 * A path is a safe post-login destination iff it is a local, single-slash
 * absolute path under the current locale. Rejects absolute URLs
 * (`https://…`), protocol-relative (`//host`), and backslash tricks
 * (`/\evil`, `/en/\t//evil`) that browsers can normalise to another origin.
 */
export function isSafeNextPath(next: string | null | undefined, locale: string): next is string {
  if (typeof next !== 'string' || next.length === 0) return false;
  if (!next.startsWith(`/${locale}/`)) return false;
  if (next.startsWith('//')) return false;
  if (next.includes('\\')) return false;
  return true;
}

/** The validated post-login destination, or the locale default. */
export function safeNextPath(next: string | null | undefined, locale: string): string {
  return isSafeNextPath(next, locale) ? next : DEFAULT_SIGNED_IN_PATH(locale);
}

/**
 * The sign-in URL to bounce an unauthenticated caller to, preserving their
 * intended path as `?next=` when it is a local route under this locale.
 * `pathname` comes from our own middleware (`x-pathname`), so it is trusted;
 * we still gate it through the same local-path check for consistency.
 */
export function signInHref(locale: string, pathname: string | null | undefined): string {
  const base = `/${locale}/sign-in`;
  return isSafeNextPath(pathname, locale) ? `${base}?next=${encodeURIComponent(pathname)}` : base;
}
