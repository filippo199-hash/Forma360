/**
 * WhatsApp account-linking codes.
 *
 * A signed-in user who has no phone number on file gets a one-time code and
 * a `wa.me` deep link that opens WhatsApp with the code pre-typed. Sending
 * that message does three jobs at once:
 *
 *   1. it proves the sender controls the number (better than self-declaring
 *      it in a form, which nothing verifies);
 *   2. it stores the number against their account; and
 *   3. it opens WhatsApp's 24-hour customer-service window, which is the
 *      ONLY way we may answer with free-form text. A business-initiated
 *      message to someone who has never written to us needs an approved
 *      message template, so "user sends first" is not a UX preference here
 *      — it is what makes the welcome reply legal to send at all.
 *
 * These helpers are pure so the browser can build the link and the webhook
 * can parse it from the same source. Code generation lives server-side in
 * `routers/users.ts`, which owns the randomness.
 */

/**
 * Crockford-style alphabet: no I, L, O or U, so a code read off a screen
 * can't be mistyped into a different valid one and can't spell anything.
 */
export const WHATSAPP_LINK_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters after the `LK` prefix. 10 × 32 symbols ≈ 50 bits of entropy. */
export const WHATSAPP_LINK_CODE_BODY_LENGTH = 10;

/**
 * `LK` prefix keeps the code recognisable inside a free-text message, so we
 * can pick it out without matching arbitrary words the sender typed around
 * it (people add "hi" or their name before hitting send).
 */
export const WHATSAPP_LINK_CODE_PREFIX = 'LK';

/** Full code length including the prefix, e.g. `LK7F3K9QW2XA`. */
export const WHATSAPP_LINK_CODE_LENGTH =
  WHATSAPP_LINK_CODE_PREFIX.length + WHATSAPP_LINK_CODE_BODY_LENGTH;

const CODE_PATTERN = new RegExp(
  `\\b${WHATSAPP_LINK_CODE_PREFIX}[${WHATSAPP_LINK_CODE_ALPHABET}]{${WHATSAPP_LINK_CODE_BODY_LENGTH}}\\b`,
  'i',
);

/**
 * Pull a link code out of an inbound WhatsApp message body. Returns the code
 * upper-cased, or null when the message carries none — the caller then treats
 * the message as ordinary conversation.
 */
export function parseWhatsAppLinkCode(body: string): string | null {
  const match = CODE_PATTERN.exec(body);
  return match === null ? null : match[0].toUpperCase();
}

/**
 * The message we pre-type into WhatsApp. Deliberately plain English rather
 * than an i18n key: it is what the *business* receives, it must survive being
 * edited by the sender, and the code is the only part that carries meaning.
 */
export function whatsAppLinkMessage(code: string): string {
  return `Link my account: ${code}`;
}

/**
 * Build the click-to-chat deep link. `businessNumber` is the WhatsApp
 * Business number in any human format; wa.me wants digits only, so we strip
 * everything else (a `+`, spaces and dashes are all common in config).
 */
export function buildWhatsAppLinkUrl(businessNumber: string, code: string): string {
  const digits = businessNumber.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(whatsAppLinkMessage(code))}`;
}
