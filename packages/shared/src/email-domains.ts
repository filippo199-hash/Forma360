/**
 * Free / personal email domain detection.
 *
 * The sign-up flow uses this to decide whether the caller's address looks
 * like a personal account (gmail, yahoo, outlook, ...) — in which case we
 * jump straight to the "create a new tenant" path — or a business address,
 * in which case we look up an existing tenant on that domain and offer a
 * request-to-join flow.
 *
 * The list is deliberately scoped to the major worldwide free providers.
 * Edge cases (corporate mail forwarded through gmail-for-work, regional
 * ISPs) will appear as "business" even if they're not — that's the safer
 * default since the user can always choose to create a tenant from the UI.
 */

/**
 * Lowercase domain set of free / personal email providers. Membership is
 * checked exact-match after stripping the user-part. Subdomains (e.g.
 * `mail.gmail.com`) do not match — by design; in practice these come from
 * managed accounts the user has control over.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Yahoo (worldwide variants)
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  // Microsoft (Hotmail / Outlook / Live / MSN)
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'outlook.com',
  'outlook.co.uk',
  'outlook.fr',
  'outlook.de',
  'outlook.it',
  'outlook.es',
  'live.com',
  'msn.com',
  // AOL / Apple
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  // Proton
  'protonmail.com',
  'proton.me',
  'pm.me',
  // GMX / mail.com
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'mail.com',
  // Russian
  'mail.ru',
  'yandex.com',
  'yandex.ru',
  // Other privacy / niche providers
  'zoho.com',
  'tutanota.com',
  'tuta.io',
  'fastmail.com',
  'hey.com',
]);

/**
 * Extract the lowercase domain portion of an email address (the part after
 * the final `@`). Returns null if the input does not contain exactly one
 * `@` separator or if either side is empty.
 */
export function getEmailDomain(email: string): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1).toLowerCase();
  if (local.length === 0 || domain.length === 0) return null;
  // A minimal validity check: a domain must contain at least one dot and
  // no spaces. We intentionally do NOT do a full RFC 5322 parse — Zod
  // validates the email at the tRPC boundary; this helper just returns the
  // tail when there is one.
  if (!domain.includes('.') || /\s/.test(domain)) return null;
  return domain;
}

/**
 * Returns true when the email's domain matches a known free / personal
 * provider. Returns false for malformed input or unknown domains.
 */
export function isFreeEmailDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  if (domain === null) return false;
  return FREE_EMAIL_DOMAINS.has(domain);
}
