/**
 * Brand-palette pipeline tests (ADR 0018).
 *
 * Pure parts (colour parsing, ranking, stylesheet extraction) plus the
 * SSRF guard with a mocked DNS resolver and fetch: refused ranges,
 * redirect re-validation + cap, timeout, size cap, content-type gate.
 */
import { describe, expect, it } from 'vitest';
import {
  collectColorsFromCss,
  collectColorsFromHtml,
  extractStylesheetUrls,
  guardedFetchText,
  harvestSiteColors,
  isPrivateAddress,
  normalizeCssColor,
  rankColorCandidates,
  SiteFetchError,
  UrlRefusedError,
  type FetchDeps,
  type ResolvedAddress,
} from './brand-palette';

// ─── Test doubles ───────────────────────────────────────────────────────────

function fakeResponse(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const status = opts.status ?? 200;
  const stub = {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(opts.headers ?? { 'content-type': 'text/html' }),
    body: null,
    text: async () => opts.body ?? '',
  };
  // Proven boundary: a minimal stub standing in for the fetch Response in tests.
  return stub as unknown as Response;
}

function publicLookup(): Promise<ResolvedAddress[]> {
  return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
}

function depsFor(
  routes: Record<string, Response | (() => Response)>,
  lookup: (hostname: string) => Promise<ResolvedAddress[]> = publicLookup,
): FetchDeps {
  return {
    fetch: (url) => {
      const entry = routes[url];
      if (entry === undefined) return Promise.reject(new Error(`no route for ${url}`));
      return Promise.resolve(typeof entry === 'function' ? entry() : entry);
    },
    lookup,
  };
}

// ─── Colour parsing ─────────────────────────────────────────────────────────

describe('normalizeCssColor', () => {
  it('normalises hex and rgb forms to lowercase #rrggbb', () => {
    expect(normalizeCssColor('#1D4ED8')).toBe('#1d4ed8');
    expect(normalizeCssColor('#abc')).toBe('#aabbcc');
    expect(normalizeCssColor('rgb(29, 78, 216)')).toBe('#1d4ed8');
    expect(normalizeCssColor('rgb(29 78 216)')).toBe('#1d4ed8');
    expect(normalizeCssColor('rgba(29, 78, 216, 0.5)')).toBe('#1d4ed8');
    expect(normalizeCssColor('rgb(29 78 216 / 50%)')).toBe('#1d4ed8');
  });

  it('rejects named colours, hsl and out-of-range channels', () => {
    expect(normalizeCssColor('red')).toBeNull();
    expect(normalizeCssColor('hsl(220, 83%, 53%)')).toBeNull();
    expect(normalizeCssColor('rgb(300, 0, 0)')).toBeNull();
    expect(normalizeCssColor('#12345')).toBeNull();
  });
});

describe('collectColorsFromCss', () => {
  it('counts frequency across literals', () => {
    const css = '.a { color: #1d4ed8; } .b { background: #1D4ED8; border: 1px solid rgb(29,78,216); } .c { color: #fff; }';
    const freq = collectColorsFromCss(css);
    expect(freq.get('#1d4ed8')).toBe(3);
    expect(freq.get('#ffffff')).toBe(1);
  });
});

describe('collectColorsFromHtml', () => {
  it('harvests style blocks, inline styles, weighted theme-color and title', () => {
    const html = `
      <html><head>
        <title> Acme Safety </title>
        <meta name="theme-color" content="#0f766e">
        <style>.hero { background: #0f766e; }</style>
      </head>
      <body><div style="color: #f97316">x</div><div style='color: #f97316'>y</div></body></html>`;
    const { colors, title } = collectColorsFromHtml(html);
    expect(title).toBe('Acme Safety');
    // 10 (theme-color weight) + 1 (style block)
    expect(colors.get('#0f766e')).toBe(11);
    expect(colors.get('#f97316')).toBe(2);
  });

  it('returns a null title when absent', () => {
    expect(collectColorsFromHtml('<p style="color:#123456">hi</p>').title).toBeNull();
  });
});

describe('extractStylesheetUrls', () => {
  it('keeps same-origin https sheets only, resolved and capped at 3', () => {
    const html = `
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="https://acme.example.com/b.css">
      <link rel="stylesheet" href="https://cdn.other.com/c.css">
      <link rel="preload" href="/not-a-sheet.css">
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="/d.css">
      <link rel="stylesheet" href="/e.css">`;
    const urls = extractStylesheetUrls(html, 'https://acme.example.com/page');
    expect(urls).toEqual([
      'https://acme.example.com/a.css',
      'https://acme.example.com/b.css',
      'https://acme.example.com/d.css',
    ]);
  });
});

describe('rankColorCandidates', () => {
  it('merges maps and orders by count desc then hex asc', () => {
    const a = new Map([
      ['#111111', 2],
      ['#222222', 5],
    ]);
    const b = new Map([
      ['#111111', 4],
      ['#333333', 5],
    ]);
    expect(rankColorCandidates([a, b])).toEqual([
      { hex: '#111111', count: 6 },
      { hex: '#222222', count: 5 },
      { hex: '#333333', count: 5 },
    ]);
  });
});

// ─── SSRF guard ─────────────────────────────────────────────────────────────

describe('isPrivateAddress', () => {
  it('refuses every private / loopback / link-local / metadata range', () => {
    for (const addr of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.99.1',
      '192.168.1.1',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.5',
      '[::1]',
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const addr of [
      '93.184.216.34',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '2606:4700::6810:84e5',
      '::ffff:93.184.216.34',
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(false);
    }
  });
});

describe('guardedFetchText — SSRF refusals', () => {
  it('refuses non-https URLs before any fetch', async () => {
    const deps = depsFor({});
    await expect(guardedFetchText('http://acme.example.com', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
    await expect(guardedFetchText('ftp://acme.example.com', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
    await expect(guardedFetchText('not a url', deps)).rejects.toBeInstanceOf(UrlRefusedError);
  });

  it('refuses URLs with embedded credentials', async () => {
    await expect(
      guardedFetchText('https://user:pass@acme.example.com', depsFor({})),
    ).rejects.toBeInstanceOf(UrlRefusedError);
  });

  it('refuses literal private IPs without resolving', async () => {
    let lookups = 0;
    const deps: FetchDeps = {
      fetch: () => Promise.reject(new Error('must not fetch')),
      lookup: () => {
        lookups += 1;
        return publicLookup();
      },
    };
    for (const target of [
      'https://10.0.0.5/',
      'https://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://192.168.0.10/',
      'https://172.20.1.1/',
      'https://[::1]/',
      'https://[fc00::1]/',
    ]) {
      await expect(guardedFetchText(target, deps), target).rejects.toBeInstanceOf(UrlRefusedError);
    }
    expect(lookups).toBe(0);
  });

  it('refuses hostnames that resolve to a private range (mock dns)', async () => {
    const deps = depsFor({}, () => Promise.resolve([{ address: '10.1.2.3', family: 4 }]));
    await expect(guardedFetchText('https://internal.example.com', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
  });

  it('refuses when ANY of several resolved addresses is private', async () => {
    const deps = depsFor({}, () =>
      Promise.resolve([
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.0.7', family: 4 },
      ]),
    );
    await expect(guardedFetchText('https://dualhomed.example.com', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
  });

  it('refuses unresolvable hostnames', async () => {
    const deps = depsFor({}, () => Promise.reject(new Error('ENOTFOUND')));
    await expect(guardedFetchText('https://nope.invalid', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
  });

  it('re-validates every redirect hop and refuses a private target', async () => {
    const deps = depsFor(
      {
        'https://acme.example.com/': fakeResponse({
          status: 302,
          headers: { location: 'https://internal.example.com/admin' },
        }),
      },
      (hostname) =>
        hostname === 'internal.example.com'
          ? Promise.resolve([{ address: '10.0.0.9', family: 4 }])
          : publicLookup(),
    );
    await expect(guardedFetchText('https://acme.example.com/', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
  });

  it('refuses a redirect that downgrades to http', async () => {
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({
        status: 301,
        headers: { location: 'http://acme.example.com/plain' },
      }),
    });
    await expect(guardedFetchText('https://acme.example.com/', deps)).rejects.toBeInstanceOf(
      UrlRefusedError,
    );
  });

  it('caps redirects at 2', async () => {
    const redirect = (to: string): Response =>
      fakeResponse({ status: 302, headers: { location: to } });
    const deps = depsFor({
      'https://acme.example.com/': redirect('https://acme.example.com/1'),
      'https://acme.example.com/1': redirect('https://acme.example.com/2'),
      'https://acme.example.com/2': redirect('https://acme.example.com/3'),
      'https://acme.example.com/3': fakeResponse({ body: 'never reached' }),
    });
    await expect(guardedFetchText('https://acme.example.com/', deps)).rejects.toBeInstanceOf(
      SiteFetchError,
    );
  });

  it('follows up to 2 same-origin redirects and returns the final body', async () => {
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({
        status: 301,
        headers: { location: '/home' },
      }),
      'https://acme.example.com/home': fakeResponse({
        body: '<title>Acme</title>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });
    const result = await guardedFetchText('https://acme.example.com/', deps);
    expect(result.finalUrl).toBe('https://acme.example.com/home');
    expect(result.body).toContain('Acme');
  });

  it('times out against a hanging server', async () => {
    const deps: FetchDeps = {
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }
        }),
      lookup: publicLookup,
    };
    await expect(
      guardedFetchText('https://slow.example.com/', deps, { timeoutMs: 25 }),
    ).rejects.toThrow('timed out');
  });

  it('refuses oversized responses', async () => {
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({ body: 'x'.repeat(2048) }),
    });
    await expect(
      guardedFetchText('https://acme.example.com/', deps, { maxBytes: 1024 }),
    ).rejects.toThrow('too large');
  });

  it('refuses disallowed content types', async () => {
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(guardedFetchText('https://acme.example.com/', deps)).rejects.toThrow(
      'unsupported content type',
    );
  });

  it('surfaces non-2xx statuses as fetch errors', async () => {
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({ status: 500, body: 'boom' }),
    });
    await expect(guardedFetchText('https://acme.example.com/', deps)).rejects.toThrow('status 500');
  });
});

// ─── End-to-end harvest ─────────────────────────────────────────────────────

describe('harvestSiteColors', () => {
  it('merges page + same-origin CSS candidates and tolerates a broken sheet', async () => {
    const html = `
      <html><head>
        <title>Acme Safety</title>
        <meta name="theme-color" content="#0f766e">
        <link rel="stylesheet" href="/main.css">
        <link rel="stylesheet" href="/broken.css">
      </head><body><div style="color:#f97316">x</div></body></html>`;
    const deps = depsFor({
      'https://acme.example.com/': fakeResponse({ body: html }),
      'https://acme.example.com/main.css': fakeResponse({
        body: '.btn { background: #0f766e; } .btn:hover { background: #0d685f; }',
        headers: { 'content-type': 'text/css' },
      }),
      'https://acme.example.com/broken.css': fakeResponse({ status: 404, body: '' }),
    });
    const harvest = await harvestSiteColors('https://acme.example.com/', deps);
    expect(harvest.title).toBe('Acme Safety');
    // theme-color weight (10) + one occurrence in main.css.
    expect(harvest.candidates[0]).toEqual({ hex: '#0f766e', count: 11 });
    expect(harvest.candidates.map((c) => c.hex)).toContain('#f97316');
    expect(harvest.candidates.map((c) => c.hex)).toContain('#0d685f');
  });

  it('refuses a non-HTML top-level page', async () => {
    const deps = depsFor({
      'https://acme.example.com/style.css': fakeResponse({
        body: '.x { color: #123456; }',
        headers: { 'content-type': 'text/css' },
      }),
    });
    await expect(harvestSiteColors('https://acme.example.com/style.css', deps)).rejects.toThrow(
      'not an HTML page',
    );
  });
});
