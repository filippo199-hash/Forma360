/**
 * Build a link into the web app, in the reader's own language.
 *
 * Every background worker that emails somebody has to construct a URL, and
 * every one of them got it wrong the same way: a literal `/en/` segment
 * baked into a template string, sitting next to the recipient's `locale`
 * which was passed to the email template and then thrown away. A French
 * document owner received a correctly translated reminder pointing at the
 * English page.
 *
 * That was three modules in three audits (training TR-A9, contractors
 * CT-O03, documents DOC-A01) and, when swept, ten call sites across the
 * worker package. It is a missing helper, not ten tickets — so this is the
 * helper, and `app-link.test.ts` walks every worker source file and fails
 * on any hardcoded locale segment, so the eleventh cannot happen quietly.
 *
 * Note the asymmetry this deliberately preserves: `packages/i18n/emails`
 * ships six locales, `packages/i18n/messages` ships ten. A recipient whose
 * locale is `ja` therefore gets an English email BODY (the template loader
 * falls back) containing a `/ja/` link — because the web app really does
 * have Japanese, and sending them to `/en/` would discard a translation
 * that exists. The body and the link are answering different questions.
 */

/**
 * A well-formed locale segment. Deliberately a SHAPE check rather than a
 * membership test against the canonical list: `@forma360/shared` does not
 * depend on `@forma360/i18n`, and duplicating ten locale codes here would
 * be a drift risk with no upside. The same shape guards template lookup in
 * `email.ts`. `packages/i18n/src/config.test.ts` pins the two together.
 */
const LOCALE_SEGMENT_RE = /^[a-z]{2}$/;

/** Matches the app's `DEFAULT_LOCALE`; asserted by the i18n package's test. */
export const DEFAULT_APP_LINK_LOCALE = 'en';

/**
 * `appLink(appUrl, locale, path)` → `<appUrl>/<locale>/<path>`.
 *
 * - `appUrl` may or may not carry a trailing slash; both work.
 * - `path` may or may not carry a leading slash; both work.
 * - `locale` may be null/undefined (nobody has set one) or malformed
 *   (data written before `users.setLocale` validated it) — both fall back
 *   to English rather than producing a URL that 404s.
 *
 * next-intl runs `localePrefix: 'always'`, so the segment is required: a
 * link without one is a redirect at best and a guess from `Accept-Language`
 * at worst.
 */
export function appLink(appUrl: string, locale: string | null | undefined, path: string): string {
  const base = appUrl.replace(/\/+$/, '');
  const segment =
    typeof locale === 'string' && LOCALE_SEGMENT_RE.test(locale) ? locale : DEFAULT_APP_LINK_LOCALE;
  const rest = path.replace(/^\/+/, '');
  return rest === '' ? `${base}/${segment}` : `${base}/${segment}/${rest}`;
}
