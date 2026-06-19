/**
 * Preset colour palette for response-set options.
 *
 * Colour is a property of the (reusable) response set — it styles the option
 * label everywhere the set is shown. Flagging, by contrast, is a property of
 * the individual question (see `flaggedOptionIds` on a multipleChoice item),
 * not the set.
 *
 * Each entry carries fully-literal Tailwind class strings (not composed at
 * runtime) so the Tailwind v4 scanner keeps them in the build.
 */

export const RESPONSE_COLOR_KEYS = [
  'green',
  'amber',
  'orange',
  'red',
  'blue',
  'teal',
  'purple',
  'grey',
] as const;

export type ResponseColorKey = (typeof RESPONSE_COLOR_KEYS)[number];

interface ColorClasses {
  /** Pill / chip background + text for showing the option label. */
  chip: string;
  /** Solid swatch dot used in the colour picker. */
  dot: string;
}

const COLOR_CLASSES: Record<ResponseColorKey, ColorClasses> = {
  green: { chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  amber: { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  orange: { chip: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  red: { chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  blue: { chip: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  teal: { chip: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
  purple: { chip: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  grey: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
};

const DEFAULT_KEY: ResponseColorKey = 'grey';

/** Normalise a stored colour value to a known palette key (fallback: grey). */
export function responseColorKey(color: string | undefined | null): ResponseColorKey {
  if (color != null && (RESPONSE_COLOR_KEYS as readonly string[]).includes(color)) {
    return color as ResponseColorKey;
  }
  return DEFAULT_KEY;
}

/** Tailwind chip classes (bg + text) for an option's stored colour. */
export function responseChipClasses(color: string | undefined | null): string {
  return COLOR_CLASSES[responseColorKey(color)].chip;
}

/** Tailwind swatch-dot class for a palette key. */
export function responseDotClass(key: ResponseColorKey): string {
  return COLOR_CLASSES[key].dot;
}
