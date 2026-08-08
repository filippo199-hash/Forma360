/**
 * Brand-palette extraction pipeline (ADR 0018).
 *
 * An org admin pastes their company website URL; we fetch the page (and up
 * to three same-origin stylesheets), collect candidate colours with rough
 * frequency counts, and ask Claude to compose an accessible palette from
 * them. Everything here is dependency-injected (fetch, DNS lookup, the
 * Anthropic client) so the pure parts unit-test without a network.
 *
 * The critical part is the SSRF guard: the URL an admin pastes reaches a
 * server-side fetch, so a hostile value could otherwise probe the private
 * network or the cloud metadata endpoint. Rules, enforced per hop (the
 * original URL AND every redirect target):
 *   - https only, no credentials in the URL;
 *   - the hostname is resolved and EVERY resolved address must be public —
 *     10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 (metadata), 0/8,
 *     ::1, ::, fc00::/7, fe80::/10 and IPv4-mapped forms are refused;
 *   - literal-IP hostnames go through the same range check;
 *   - at most 2 redirects, 5 s total budget, 2 MB response cap;
 *   - only `text/html` / `text/css` responses are read.
 *
 * Nothing fetched from the website is ever logged — callers log hostnames
 * and candidate counts only.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ─── Errors ─────────────────────────────────────────────────────────────────

/** The URL was refused by policy (scheme, private address, redirect target). */
export class UrlRefusedError extends Error {}

/** The site could not be fetched/parsed within limits (timeout, size, type). */
export class SiteFetchError extends Error {}

// ─── SSRF guard ─────────────────────────────────────────────────────────────

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface FetchDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** DNS resolution for a hostname — `node:dns/promises` `lookup(host, { all: true })`. */
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((p) => p > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateIpv4(parts: [number, number, number, number]): boolean {
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  return false;
}

/**
 * Expand an IPv6 literal into its 8 hextets. Handles `::` compression and
 * a trailing IPv4 dotted quad (`::ffff:127.0.0.1`). Returns null when the
 * string is not valid IPv6.
 */
function expandIpv6(raw: string): number[] | null {
  let host = raw;
  // Trailing IPv4-in-IPv6 → convert the dotted quad to two hextets.
  const v4tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (v4tail !== null) {
    const quad = parseIpv4(v4tail[2] ?? '');
    if (quad === null) return null;
    const [a, b, c, d] = quad;
    host = `${v4tail[1] ?? ''}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/**
 * Is this literal address inside a refused (private / loopback /
 * link-local / metadata) range? Exported for direct unit-testing.
 */
export function isPrivateAddress(rawAddress: string): boolean {
  const address = rawAddress
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase();
  const v4 = parseIpv4(address);
  if (v4 !== null) return isPrivateIpv4(v4);

  if (address.includes(':')) {
    const groups = expandIpv6(address);
    if (groups === null) return true; // unparseable → refuse
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
    const allZeroTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
    // :: (unspecified) and ::1 (loopback)
    if (allZeroTo5 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
    // IPv4-mapped ::ffff:a.b.c.d → check the embedded IPv4
    if (allZeroTo5 && g5 === 0xffff) {
      return isPrivateIpv4([(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff]);
    }
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }
  return false;
}

/** Is this hostname a literal IP (v4 or bracketed/unbracketed v6)? */
function literalIp(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (parseIpv4(bare) !== null) return bare;
  if (bare.includes(':') && expandIpv6(bare) !== null) return bare;
  return null;
}

/**
 * Validate one hop's URL: https only, no embedded credentials, and every
 * address the hostname resolves to must be public. Throws UrlRefusedError.
 */
export async function assertPublicHttpsUrl(url: URL, deps: FetchDeps): Promise<void> {
  if (url.protocol !== 'https:') throw new UrlRefusedError('https only');
  if (url.username !== '' || url.password !== '') {
    throw new UrlRefusedError('credentials in URL');
  }
  const literal = literalIp(url.hostname);
  if (literal !== null) {
    if (isPrivateAddress(literal)) throw new UrlRefusedError('private address');
    return;
  }
  let resolved: ResolvedAddress[];
  try {
    resolved = await deps.lookup(url.hostname);
  } catch {
    throw new UrlRefusedError('hostname did not resolve');
  }
  if (resolved.length === 0) throw new UrlRefusedError('hostname did not resolve');
  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) throw new UrlRefusedError('private address');
  }
}

// ─── Guarded fetch ──────────────────────────────────────────────────────────

export interface GuardedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface GuardedFetchResult {
  finalUrl: string;
  contentType: string;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 2;
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/css'];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch a URL under the SSRF policy: every hop host-validated, redirects
 * capped, one total timeout budget, response size capped, content type
 * allowlisted. Returns the decoded text body.
 */
export async function guardedFetchText(
  rawUrl: string,
  deps: FetchDeps,
  opts: GuardedFetchOptions = {},
): Promise<GuardedFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlRefusedError('invalid URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      await assertPublicHttpsUrl(url, deps);

      let response: Response;
      try {
        response = await deps.fetch(url.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,text/css;q=0.9,*/*;q=0.1',
            'user-agent': 'Forma360-BrandPalette/1.0',
          },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new SiteFetchError('timed out');
        throw new SiteFetchError(err instanceof Error ? err.message : 'fetch failed');
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (location === null) throw new SiteFetchError('redirect without location');
        if (redirects >= maxRedirects) throw new SiteFetchError('too many redirects');
        try {
          url = new URL(location, url);
        } catch {
          throw new UrlRefusedError('invalid redirect target');
        }
        continue;
      }

      if (!response.ok) throw new SiteFetchError(`status ${response.status}`);

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
        throw new SiteFetchError('unsupported content type');
      }

      const body = await readBodyCapped(response, maxBytes, controller);
      return { finalUrl: url.toString(), contentType, body };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    // Bodyless Response (test doubles): fall back to text() with a length gate.
    const text = await response.text();
    if (text.length > maxBytes) throw new SiteFetchError('response too large');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        received += value.byteLength;
        if (received > maxBytes) {
          controller.abort();
          throw new SiteFetchError('response too large');
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof SiteFetchError) throw err;
    if (controller.signal.aborted) throw new SiteFetchError('timed out');
    throw new SiteFetchError('read failed');
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

// ─── Colour collection ──────────────────────────────────────────────────────

/** Weight given to `<meta name="theme-color">` — a declared brand colour. */
const THEME_COLOR_WEIGHT = 10;
const MAX_CANDIDATES = 24;

/**
 * Normalise a CSS colour literal to lowercase `#rrggbb`. Accepts `#rgb`,
 * `#rrggbb`, and `rgb()/rgba()` in comma or space syntax. Returns null
 * for anything else (named colours, hsl, gradients, …).
 */
export function normalizeCssColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const hex6 = /^#([0-9a-f]{6})$/.exec(value);
  if (hex6 !== null) return `#${hex6[1] ?? ''}`;
  const hex3 = /^#([0-9a-f]{3})$/.exec(value);
  if (hex3 !== null) {
    const h = hex3[1] ?? '';
    const [r, g, b] = [h[0] ?? '0', h[1] ?? '0', h[2] ?? '0'];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(
      value,
    );
  if (rgb !== null) {
    const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (parts.some((p) => p > 255)) return null;
    return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

const COLOR_LITERAL_RE =
  /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*(?:[,/]\s*[\d.%]+\s*)?\)/g;

/** Collect colour literals from CSS text into a frequency map. */
export function collectColorsFromCss(css: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const match of css.match(COLOR_LITERAL_RE) ?? []) {
    const hex = normalizeCssColor(match);
    if (hex !== null) freq.set(hex, (freq.get(hex) ?? 0) + 1);
  }
  return freq;
}

export interface HtmlColorHarvest {
  colors: Map<string, number>;
  title: string | null;
}

/**
 * Collect candidate colours from an HTML document: `style=""` attributes,
 * `<style>` blocks, and `<meta name="theme-color">` (weighted — it is the
 * site's own declaration of its brand colour). Also extracts the page
 * title for the model prompt.
 */
export function collectColorsFromHtml(html: string): HtmlColorHarvest {
  const freq = new Map<string, number>();
  const add = (map: Map<string, number>): void => {
    for (const [hex, count] of map) freq.set(hex, (freq.get(hex) ?? 0) + count);
  };

  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    add(collectColorsFromCss(m[1] ?? ''));
  }
  for (const m of html.matchAll(/style\s*=\s*"([^"]*)"/gi)) {
    add(collectColorsFromCss(m[1] ?? ''));
  }
  for (const m of html.matchAll(/style\s*=\s*'([^']*)'/gi)) {
    add(collectColorsFromCss(m[1] ?? ''));
  }

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/name\s*=\s*["']theme-color["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
    const hex = content !== null ? normalizeCssColor(content[1] ?? '') : null;
    if (hex !== null) freq.set(hex, (freq.get(hex) ?? 0) + THEME_COLOR_WEIGHT);
  }

  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = titleMatch !== null ? (titleMatch[1] ?? '').trim() : null;
  return { colors: freq, title: title !== null && title.length > 0 ? title : null };
}

/**
 * Same-origin stylesheet URLs referenced by `<link rel="stylesheet">`,
 * resolved against the (post-redirect) page URL. Cross-origin CSS is
 * skipped — we never fetch hosts the admin didn't point us at. Max 3.
 */
export function extractStylesheetUrls(html: string, pageUrl: string, max = 3): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["'](?:[^"']*\s)?stylesheet(?:\s[^"']*)?["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href === null) continue;
    let resolved: URL;
    try {
      resolved = new URL(href[1] ?? '', base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' || resolved.origin !== base.origin) continue;
    const asString = resolved.toString();
    if (!out.includes(asString)) out.push(asString);
    if (out.length >= max) break;
  }
  return out;
}

export interface ColorCandidate {
  hex: string;
  count: number;
}

/**
 * Merge frequency maps and rank by count (desc), then hex (asc) for
 * determinism. Capped to the top {@link MAX_CANDIDATES}.
 */
export function rankColorCandidates(maps: Iterable<Map<string, number>>): ColorCandidate[] {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [hex, count] of map) merged.set(hex, (merged.get(hex) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
    .slice(0, MAX_CANDIDATES);
}

// ─── Site harvest orchestration ─────────────────────────────────────────────

export interface SiteColorHarvest {
  candidates: ColorCandidate[];
  title: string | null;
  finalUrl: string;
}

/**
 * Fetch the page + up to 3 same-origin stylesheets (all SSRF-guarded) and
 * return the ranked colour candidates. Stylesheet failures are tolerated —
 * a page whose CSS 404s can still yield a palette from inline styles.
 */
export async function harvestSiteColors(
  rawUrl: string,
  deps: FetchDeps,
  opts: GuardedFetchOptions = {},
): Promise<SiteColorHarvest> {
  const page = await guardedFetchText(rawUrl, deps, opts);
  if (!page.contentType.startsWith('text/html')) {
    throw new SiteFetchError('not an HTML page');
  }
  const fromHtml = collectColorsFromHtml(page.body);
  const maps: Map<string, number>[] = [fromHtml.colors];

  for (const cssUrl of extractStylesheetUrls(page.body, page.finalUrl)) {
    try {
      const css = await guardedFetchText(cssUrl, deps, opts);
      if (css.contentType.startsWith('text/css')) {
        maps.push(collectColorsFromCss(css.body));
      }
    } catch {
      // Tolerated: one broken stylesheet must not sink the harvest.
    }
  }

  return {
    candidates: rankColorCandidates(maps),
    title: fromHtml.title,
    finalUrl: page.finalUrl,
  };
}

// ─── Claude palette proposal ────────────────────────────────────────────────

const hex6 = z.string().regex(/^#[0-9a-f]{6}$/);

export const brandPaletteSchema = z.object({
  primaryColor: hex6,
  accentColor: hex6,
  chartColors: z.array(hex6).min(4).max(8),
  reasoning: z.string().min(1).max(2000),
});
export type BrandPalette = z.infer<typeof brandPaletteSchema>;

const PROPOSE_PALETTE_TOOL: Anthropic.Tool = {
  name: 'proposePalette',
  description: 'Record the proposed brand palette for this website. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      primaryColor: {
        type: 'string',
        description:
          'The main brand colour as lowercase #rrggbb. Must work as a button/link colour on white: never near-white or near-black.',
      },
      accentColor: {
        type: 'string',
        description:
          'A complementary secondary colour as lowercase #rrggbb, distinct from the primary.',
      },
      chartColors: {
        type: 'array',
        items: { type: 'string' },
        description:
          '4-8 lowercase #rrggbb colours for chart series, anchored on the brand. Order them so ADJACENT colours contrast clearly with each other (alternate hue families / lightness), and keep every one legible on a white background.',
      },
      reasoning: {
        type: 'string',
        description: 'One or two sentences: which candidates you anchored on and why.',
      },
    },
    required: ['primaryColor', 'accentColor', 'chartColors', 'reasoning'],
  },
};

const PALETTE_SYSTEM_PROMPT =
  'You are a brand designer picking an application colour theme from colours scraped off a company website. ' +
  'The candidate list is ranked by rough frequency; frequency is a hint, not an order — greys, whites and blacks are usually chrome, not brand. ' +
  'Pick the colour that most plausibly IS the brand as primary (avoid near-white and near-black primaries; if the brand colour is too light or too dark to sit behind white text or on a white page, shift its lightness while keeping the hue). ' +
  'Choose a tasteful accent that complements it, and 4-8 chart colours anchored on the brand, ordered for adjacent contrast. ' +
  'All colours must be lowercase #rrggbb. Call proposePalette exactly once.';

export interface PaletteProposalInput {
  url: string;
  title: string | null;
  candidates: ColorCandidate[];
}

/**
 * Ask Claude to compose the palette from the ranked candidates. Forced
 * single tool call, Zod-parsed, with a bounded correction loop (2
 * attempts) when the tool input fails validation.
 */
export async function proposeBrandPalette(
  client: Anthropic,
  model: string,
  input: PaletteProposalInput,
): Promise<BrandPalette> {
  const candidateLines = input.candidates.map((c) => `${c.hex} (seen ~${c.count}x)`).join('\n');
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        `Website: ${input.url}\n` +
        `Page title: ${input.title ?? '(none)'}\n\n` +
        `Candidate colours, ranked by frequency:\n${candidateLines}\n\n` +
        'Propose the palette by calling proposePalette.',
    },
  ];

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: PALETTE_SYSTEM_PROMPT,
      tools: [PROPOSE_PALETTE_TOOL],
      tool_choice: { type: 'tool', name: 'proposePalette' },
      messages,
    });
    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposePalette',
    );
    if (toolBlock === undefined) {
      throw new Error('No palette proposal produced.');
    }
    const parsed = brandPaletteSchema.safeParse(toolBlock.input);
    if (parsed.success) return parsed.data;
    if (attempts >= 2) {
      throw new Error('Could not produce a valid palette.');
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: `The palette was invalid: ${parsed.error.message}. Call proposePalette again with corrected values (lowercase #rrggbb everywhere, 4-8 chartColors).`,
          is_error: true,
        },
      ],
    });
  }
}
