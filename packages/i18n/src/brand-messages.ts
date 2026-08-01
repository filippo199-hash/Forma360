/**
 * Per-brand message overrides (ADR 0010).
 *
 * The base bundles in `messages/<locale>.json` carry the default brand's
 * copy. A brand overrides only the keys it needs — product name mentions,
 * renamed module titles, adjusted descriptions — in
 * `overrides/<brand>/<locale>.json`, and the request config deep-merges the
 * override on top of the base at load time. Call sites (`t('key')`) never
 * know brands exist.
 */
import type { BrandId } from '@forma360/shared/brand';
import type { Locale } from './config';

export type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `override` on top of `base`. Objects merge recursively; every
 * other value (strings, arrays) is replaced wholesale. Arrays replace rather
 * than merge because message arrays are ordered lists (e.g. suggestion
 * chips) where index-wise merging would corrupt content.
 */
export function mergeMessages(base: Messages, override: Messages): Messages {
  const out: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      out[key] = mergeMessages(baseValue, overrideValue);
    } else {
      out[key] = overrideValue;
    }
  }
  return out;
}

/**
 * Load the message bundle for a locale, branded. The default brand returns
 * the base bundle untouched. Non-default brands deep-merge their override
 * file; a missing override file is a build error (every brand ships all ten
 * locale override files, even if some are near-empty).
 *
 * The import specifiers keep the directory segments literal so bundlers can
 * statically enumerate the JSON files — same constraint as the base-message
 * import in request.ts.
 */
export async function loadBrandedMessages(brand: BrandId, locale: Locale): Promise<Messages> {
  const base = (await import(`../messages/${locale}.json`)).default as Messages;
  if (brand === 'freehs') {
    const override = (await import(`../overrides/freehs/${locale}.json`)).default as Messages;
    return mergeMessages(base, override);
  }
  return base;
}
