/**
 * Tenant theme CSS builder (ADR 0018).
 *
 * Turns a tenant's saved branding palette into a CSS string that overrides
 * the app's theme custom properties for BOTH colour schemes. The signed-in
 * layout injects the result as an inline `<style>` in the body, which is
 * unlayered and later in document order than the compiled Tailwind sheet,
 * so it wins over the `@theme` defaults and the `.dark` block in
 * `globals.css` without `!important`.
 *
 * Tokens written (names must match `apps/web/app/globals.css`):
 *   - `--color-primary` / `--color-primary-foreground`
 *   - `--color-ring`
 *   - `--color-brand` / `--color-brand-foreground`
 *   - `--color-brand-accent` (new: the tenant accent; components that want
 *     the accent use `var(--color-brand-accent)`)
 *   - `--chart-1`..`--chart-8` (only when `chartColors` is set; otherwise
 *     the defaults in globals.css stay in force)
 *
 * WCAG guard: text on the primary must reach 4.5:1 (WCAG 1.4.3). If white
 * fails on the given primary we switch the foreground token to the app's
 * dark foreground; if the primary itself is near-white (unusable as a
 * button/link colour on white surfaces) we refuse the whole palette and
 * return `''` so the default theme applies untouched.
 *
 * Dark-mode formula: colours tuned for a white page are often too dark on
 * the dark background, so each one is lightened by repeatedly mixing 8%
 * white into it (linear RGB-space mix, up to 20 steps) until it reaches
 * the required contrast against the dark app background
 * (`hsl(220 14% 8%)` ≈ #121317): 4.5:1 for the primary (it carries text
 * states), 3:1 for accent + chart colours (non-text UI, WCAG 1.4.11).
 *
 * Injection safety: every emitted value is round-tripped through
 * `parseHexColor` → `formatHex`, so only canonical `#rrggbb` strings can
 * reach the stylesheet — a corrupted settings row cannot inject CSS.
 */

export interface TenantThemeBranding {
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
  chartColors?: string[] | undefined;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `hsl(220 14% 8%)` — the dark-mode `--color-background`. */
const DARK_BACKGROUND: Rgb = { r: 18, g: 19, b: 23 };
/** `hsl(220 14% 11%)` — the light-mode `--color-foreground`. */
const DARK_FOREGROUND_HEX = '#181b20';
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const WHITE_HEX = '#ffffff';

/** Primaries lighter than this relative luminance are unusable on white. */
const NEAR_WHITE_LUMINANCE = 0.8;
const TEXT_CONTRAST = 4.5;
const GRAPHIC_CONTRAST = 3;
const LIGHTEN_STEP = 0.08;
const MAX_LIGHTEN_STEPS = 20;

/** Parse a `#rrggbb` (or `#rgb`) string. Returns null for anything else. */
export function parseHexColor(raw: string): Rgb | null {
  const value = raw.trim();
  const six = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (six !== null) {
    const hex = six[1] ?? '';
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const three = /^#([0-9a-fA-F]{3})$/.exec(value);
  if (three !== null) {
    const hex = three[1] ?? '';
    const [r, g, b] = [hex[0] ?? '0', hex[1] ?? '0', hex[2] ?? '0'];
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }
  return null;
}

export function formatHex(rgb: Rgb): string {
  const part = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** WCAG relative luminance (sRGB). */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colours (always >= 1). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

/**
 * Lighten `rgb` (by mixing white in 8% steps) until it reaches
 * `minContrast` against the dark background. See the module doc for why.
 */
export function lightenForDarkBackground(rgb: Rgb, minContrast: number): Rgb {
  let current = rgb;
  for (let i = 0; i < MAX_LIGHTEN_STEPS; i += 1) {
    if (contrastRatio(current, DARK_BACKGROUND) >= minContrast) return current;
    current = mix(current, WHITE, LIGHTEN_STEP);
  }
  return current;
}

/** White when it reaches 4.5:1 on `background`, else the dark foreground. */
function foregroundOn(background: Rgb): string {
  return contrastRatio(WHITE, background) >= TEXT_CONTRAST ? WHITE_HEX : DARK_FOREGROUND_HEX;
}

/**
 * Pad the chart colours out to 8 slots. Slots beyond the provided list
 * repeat the cycle progressively lightened (22% white per repeat) so a
 * 4-colour palette still yields 8 distinguishable series.
 */
export function padChartColors(colors: readonly Rgb[]): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < 8; i += 1) {
    const base = colors[i % colors.length];
    if (base === undefined) break; // colors is empty — caller guards.
    const cycle = Math.floor(i / colors.length);
    out.push(cycle === 0 ? base : mix(base, WHITE, Math.min(0.22 * cycle, 0.66)));
  }
  return out;
}

/**
 * Build the inline-style CSS for a tenant palette. Returns `''` when the
 * palette is absent or unusable — the caller renders nothing and the
 * default theme applies.
 */
export function buildTenantThemeCss(branding: TenantThemeBranding | null | undefined): string {
  if (branding === null || branding === undefined) return '';
  const primaryRaw = branding.primaryColor;
  if (primaryRaw === undefined) return '';
  const primary = parseHexColor(primaryRaw);
  if (primary === null) return '';
  // Near-white primaries cannot carry buttons/links on white surfaces; a
  // "corrected" colour would no longer be the brand, so refuse entirely.
  if (relativeLuminance(primary) > NEAR_WHITE_LUMINANCE) return '';

  const accent = branding.accentColor !== undefined ? parseHexColor(branding.accentColor) : null;
  const accentLight = accent ?? primary;

  const chartRgbs = (branding.chartColors ?? [])
    .map(parseHexColor)
    .filter((c): c is Rgb => c !== null);
  const chartLight = chartRgbs.length > 0 ? padChartColors(chartRgbs) : [];

  const primaryHex = formatHex(primary);
  const primaryFg = foregroundOn(primary);

  const lightVars: string[] = [
    `--color-primary: ${primaryHex};`,
    `--color-primary-foreground: ${primaryFg};`,
    `--color-ring: ${primaryHex};`,
    `--color-brand: ${primaryHex};`,
    `--color-brand-foreground: ${primaryFg};`,
    `--color-brand-accent: ${formatHex(accentLight)};`,
    ...chartLight.map((c, i) => `--chart-${i + 1}: ${formatHex(c)};`),
  ];

  const primaryDark = lightenForDarkBackground(primary, TEXT_CONTRAST);
  const primaryDarkHex = formatHex(primaryDark);
  const primaryDarkFg = foregroundOn(primaryDark);
  const accentDark = lightenForDarkBackground(accentLight, GRAPHIC_CONTRAST);

  const darkVars: string[] = [
    `--color-primary: ${primaryDarkHex};`,
    `--color-primary-foreground: ${primaryDarkFg};`,
    `--color-ring: ${primaryDarkHex};`,
    `--color-brand: ${primaryDarkHex};`,
    `--color-brand-foreground: ${primaryDarkFg};`,
    `--color-brand-accent: ${formatHex(accentDark)};`,
    ...chartLight.map(
      (c, i) => `--chart-${i + 1}: ${formatHex(lightenForDarkBackground(c, GRAPHIC_CONTRAST))};`,
    ),
  ];

  return `:root { ${lightVars.join(' ')} }\n.dark { ${darkVars.join(' ')} }`;
}
