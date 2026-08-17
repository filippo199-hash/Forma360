/**
 * SEC-H01..H08 — the security-header policy is pinned.
 *
 * The app shipped with no security headers whatsoever: no CSP, no HSTS, no
 * X-Frame-Options, no Referrer-Policy. This guard reads the real
 * `next.config.ts` header table so a future edit that drops a directive —
 * or widens one to `*` — fails CI instead of quietly un-hardening
 * production.
 *
 * It asserts the SHAPE of the policy, not a byte-for-byte string, so adding
 * a legitimately-needed host stays a one-line change. What it will not let
 * you do is remove a directive or make one unbounded.
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function headerRules(): Promise<HeaderRule[]> {
  const headersFn = nextConfig.headers;
  expect(headersFn, 'next.config.ts must define headers()').toBeTypeOf('function');
  // `headers()` is declared on NextConfig; the cast is to call it detached
  // from the config object, which it does not rely on.
  const rules = await (headersFn as () => Promise<HeaderRule[]>)();
  return rules;
}

async function globalHeaders(): Promise<Map<string, string>> {
  const rules = await headerRules();
  const global = rules.find((r) => r.source === '/:path*');
  expect(global, 'a rule matching every path must exist').toBeDefined();
  return new Map((global as HeaderRule).headers.map((h) => [h.key, h.value]));
}

function csp(value: string): Map<string, string> {
  return new Map(
    value.split(';').map((part) => {
      const trimmed = part.trim();
      const space = trimmed.indexOf(' ');
      return space === -1
        ? ([trimmed, ''] as const)
        : ([trimmed.slice(0, space), trimmed.slice(space + 1)] as const);
    }),
  );
}

describe('security headers (guard)', () => {
  it('SEC-H01: every header we rely on is present', async () => {
    const headers = await globalHeaders();
    for (const key of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(headers.has(key), `${key} is missing`).toBe(true);
    }
  });

  it('SEC-H02: nosniff, SAMEORIGIN and a referrer policy that does not leak tokens cross-origin', async () => {
    const headers = await globalHeaders();
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    // Opaque tokens live in URLs on this app, so a full cross-origin Referer
    // would hand them over. Anything laxer than these two is a regression.
    expect(['strict-origin-when-cross-origin', 'no-referrer']).toContain(
      headers.get('Referrer-Policy'),
    );
  });

  it('SEC-H03: framing is restricted to our own origin', async () => {
    const directives = csp((await globalHeaders()).get('Content-Security-Policy') as string);
    // `'self'` rather than `'none'` is deliberate — the document viewer frames
    // our own /api routes. What must never appear here is a wildcard.
    expect(directives.get('frame-ancestors')).toBe("'self'");
  });

  it('SEC-H04: the dangerous directives are locked down', async () => {
    const directives = csp((await globalHeaders()).get('Content-Security-Policy') as string);
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'self'");
    expect(directives.get('form-action')).toBe("'self'");
    expect(directives.get('default-src')).toBe("'self'");
  });

  it('SEC-H05: no directive is a bare wildcard, and script/connect never allow all of https', async () => {
    const directives = csp((await globalHeaders()).get('Content-Security-Policy') as string);
    for (const [name, value] of directives) {
      expect(value.split(' '), `${name} must not be a bare wildcard`).not.toContain('*');
    }
    // `https:` is tolerated for passive media only (see next.config.ts). It
    // must never widen the two directives that carry code or exfiltrate data.
    for (const name of ['script-src', 'connect-src']) {
      const value = directives.get(name) ?? '';
      expect(value.split(' '), `${name} must not allow all https origins`).not.toContain('https:');
    }
  });

  it('SEC-H06: script-src forbids eval in a production build', async () => {
    const directives = csp((await globalHeaders()).get('Content-Security-Policy') as string);
    const scriptSrc = (directives.get('script-src') ?? '').split(' ');
    if (process.env.NODE_ENV === 'production') {
      expect(scriptSrc).not.toContain("'unsafe-eval'");
    }
    // In every environment, scripts come from our own origin only.
    expect(scriptSrc).toContain("'self'");
  });

  it('SEC-H07: the field-app capabilities stay permitted and the unused ones stay denied', async () => {
    const policy = (await globalHeaders()).get('Permissions-Policy') as string;
    // QR scanning, dictation and site capture are real features — denying
    // these silently breaks them on mobile.
    for (const allowed of ['camera=(self)', 'microphone=(self)', 'geolocation=(self)']) {
      expect(policy).toContain(allowed);
    }
    for (const denied of ['payment=()', 'usb=()', 'display-capture=()']) {
      expect(policy).toContain(denied);
    }
  });

  it('SEC-H08: token-bearing and machine-facing routes are marked noindex', async () => {
    const rules = await headerRules();
    const noindex = rules.find((r) =>
      r.headers.some((h) => h.key === 'X-Robots-Tag' && h.value.includes('noindex')),
    );
    expect(noindex, 'an X-Robots-Tag: noindex rule must exist').toBeDefined();
    for (const path of ['s', 'scan', 'render', 'api']) {
      expect((noindex as HeaderRule).source).toContain(path);
    }
  });
});
