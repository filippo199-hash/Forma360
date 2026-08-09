/**
 * Tenant theme CSS builder tests (ADR 0018).
 *
 * Covers the WCAG contrast guard (foreground flip, near-white refusal),
 * the dark-mode lightening formula, chart-variable emission/padding, and
 * the injection-safety property that only canonical hex reaches the CSS.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTenantThemeCss,
  contrastRatio,
  lightenForDarkBackground,
  padChartColors,
  parseHexColor,
  relativeLuminance,
} from './tenant-theme';

const DARK_BG = { r: 18, g: 19, b: 23 };

describe('parseHexColor', () => {
  it('parses #rrggbb and #rgb, rejects everything else', () => {
    expect(parseHexColor('#1d4ed8')).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1d4ed8; } body { display: none')).toBeNull();
  });
});

describe('contrast math', () => {
  it('computes the canonical white/black extremes', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    const a = { r: 29, g: 78, b: 216 };
    const b = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe('lightenForDarkBackground', () => {
  it('lightens a dark navy until it holds 4.5:1 on the dark background', () => {
    const navy = parseHexColor('#1e3a8a');
    if (navy === null) throw new Error('bad fixture');
    expect(contrastRatio(navy, DARK_BG)).toBeLessThan(4.5);
    const lit = lightenForDarkBackground(navy, 4.5);
    expect(contrastRatio(lit, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves an already-light colour untouched', () => {
    const light = parseHexColor('#93c5fd');
    if (light === null) throw new Error('bad fixture');
    expect(lightenForDarkBackground(light, 4.5)).toEqual(light);
  });
});

describe('buildTenantThemeCss', () => {
  it('emits both scopes with the full token set for a mid-tone primary', () => {
    const css = buildTenantThemeCss({ primaryColor: '#1d4ed8', accentColor: '#f97316' });
    expect(css).toContain(':root {');
    expect(css).toContain('.dark {');
    for (const token of [
      '--color-primary:',
      '--color-primary-foreground:',
      '--color-ring:',
      '--color-brand:',
      '--color-brand-foreground:',
      '--color-brand-accent:',
    ]) {
      // Present in both the light and the dark scope.
      expect(css.split(token).length - 1).toBe(2);
    }
    // Light scope carries the brand colour verbatim; white passes on #1d4ed8.
    expect(css).toContain('--color-primary: #1d4ed8;');
    expect(css.split('\n')[0]).toContain('--color-primary-foreground: #ffffff;');
  });

  it('uses a dark foreground when white fails 4.5:1 on the primary', () => {
    // Amber: white-on-amber is ~1.6:1 — the guard must flip the foreground.
    const css = buildTenantThemeCss({ primaryColor: '#f59e0b' });
    const lightScope = css.split('\n')[0] ?? '';
    expect(lightScope).toContain('--color-primary-foreground: #181b20;');
  });

  it('returns empty CSS for a near-white primary (default palette stays)', () => {
    expect(buildTenantThemeCss({ primaryColor: '#f8fafc' })).toBe('');
    expect(buildTenantThemeCss({ primaryColor: '#ffffff' })).toBe('');
  });

  it('returns empty CSS for missing or malformed input', () => {
    expect(buildTenantThemeCss(null)).toBe('');
    expect(buildTenantThemeCss(undefined)).toBe('');
    expect(buildTenantThemeCss({})).toBe('');
    expect(buildTenantThemeCss({ primaryColor: 'blue' })).toBe('');
    // Injection attempt never reaches the stylesheet.
    expect(buildTenantThemeCss({ primaryColor: '#123456; } * { color: red' })).toBe('');
  });

  it('lightens the dark-scope primary to hold contrast on the dark background', () => {
    const css = buildTenantThemeCss({ primaryColor: '#1e3a8a' });
    const darkScope = css.split('\n')[1] ?? '';
    const match = /--color-primary: (#[0-9a-f]{6});/.exec(darkScope);
    const litHex = match?.[1];
    expect(litHex).toBeDefined();
    const lit = parseHexColor(litHex ?? '');
    if (lit === null) throw new Error('unparseable emitted colour');
    expect(contrastRatio(lit, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('emits --chart-1..8, padding a short list by cycling', () => {
    const css = buildTenantThemeCss({
      primaryColor: '#1d4ed8',
      chartColors: ['#1d4ed8', '#f97316', '#16a34a', '#9333ea'],
    });
    for (let i = 1; i <= 8; i += 1) {
      expect(css.split(`--chart-${i}:`).length - 1).toBe(2);
    }
    // Slot 5 repeats slot 1's hue, lightened — never an identical colour.
    const lightScope = css.split('\n')[0] ?? '';
    const chart1 = /--chart-1: (#[0-9a-f]{6});/.exec(lightScope)?.[1];
    const chart5 = /--chart-5: (#[0-9a-f]{6});/.exec(lightScope)?.[1];
    expect(chart1).toBe('#1d4ed8');
    expect(chart5).toBeDefined();
    expect(chart5).not.toBe(chart1);
  });

  it('skips chart variables entirely when no chartColors are set', () => {
    const css = buildTenantThemeCss({ primaryColor: '#1d4ed8' });
    expect(css).not.toContain('--chart-');
  });

  it('drops malformed chart entries instead of emitting them', () => {
    const css = buildTenantThemeCss({
      primaryColor: '#1d4ed8',
      chartColors: ['#16a34a', 'nonsense; } html { display: none'],
    });
    expect(css).toContain('--chart-1: #16a34a;');
    expect(css).not.toContain('nonsense');
    expect(css).not.toContain('display: none');
  });
});

describe('padChartColors', () => {
  it('keeps an 8-colour list as-is', () => {
    const colors = Array.from({ length: 8 }, (_, i) => ({ r: i * 10, g: 0, b: 0 }));
    expect(padChartColors(colors)).toEqual(colors);
  });
});
