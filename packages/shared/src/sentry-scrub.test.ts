/**
 * Tests for the Sentry event scrubber.
 *
 * Edge case IDs (SC-E01..E10) — these guard a privacy boundary, so each
 * one asserts something does NOT appear, not just that something does.
 */
import { describe, expect, it } from 'vitest';

import { REDACTED, redactUrl, scrubEvent, type ScrubbableEvent } from './sentry-scrub';

describe('redactUrl (SC-E01)', () => {
  it('redacts the RAMS client share token but keeps the route shape', () => {
    expect(redactUrl('https://freehs.software/s/9f8a7b6c5d4e3f2a1b0c')).toBe(
      `https://freehs.software/s/${REDACTED}`,
    );
  });

  it('redacts the site-gate scan token', () => {
    expect(redactUrl('/scan/abc123def456')).toBe(`/scan/${REDACTED}`);
  });

  it('keeps path segments after the token', () => {
    expect(redactUrl('/s/tok123/accept')).toBe(`/s/${REDACTED}/accept`);
  });

  it('drops query strings and fragments wholesale', () => {
    expect(redactUrl('/en/incidents?q=stabbing&token=secret#frag')).toBe('/en/incidents');
  });

  it('leaves an ordinary route untouched', () => {
    expect(redactUrl('/en/rams/01J8XABCDEF')).toBe('/en/rams/01J8XABCDEF');
  });

  it('redacts the emailed password-reset token path (SC-E10, ADR 0019)', () => {
    expect(
      redactUrl('https://freehs.software/api/auth/reset-password/GkT29xLmnOpq?callbackURL=%2Fen'),
    ).toBe(`https://freehs.software/api/auth/reset-password/${REDACTED}`);
  });
});

describe('scrubEvent request handling (SC-E02..E04)', () => {
  it('drops the request body entirely — incident details must never leave', () => {
    const event: ScrubbableEvent = {
      request: {
        url: 'https://freehs.software/api/trpc/incidents.create',
        method: 'POST',
        data: {
          title: 'Needlestick injury, ward 4',
          persons: [{ name: 'A. Nurse', injury: 'sharps', hospitalised: true }],
        },
      },
    };
    const out = scrubEvent(event);
    expect(out.request?.data).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('Needlestick');
    expect(JSON.stringify(out)).not.toContain('A. Nurse');
  });

  it('drops cookies, query strings and the raw env', () => {
    const out = scrubEvent({
      request: {
        url: '/x',
        cookies: { 'better-auth.session_token': 'super-secret' },
        query_string: 'token=secret',
        env: { DATABASE_URL: 'postgres://user:pw@host/db' },
      },
    });
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.env).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('super-secret');
    expect(JSON.stringify(out)).not.toContain('postgres://');
  });

  it('allows only safe headers through (SC-E04)', () => {
    const out = scrubEvent({
      request: {
        url: '/x',
        headers: {
          Cookie: 'session=abc',
          Authorization: 'Bearer xyz',
          'X-Api-Key': 'k',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://freehs.software/s/tok123',
        } as Record<string, string>,
      },
    });
    expect(Object.keys(out.request?.headers ?? {}).sort()).toEqual([
      'content-type',
      'referer',
      'user-agent',
    ]);
    // The referer is itself a token-bearing URL.
    expect(out.request?.headers?.referer).toBe(`https://freehs.software/s/${REDACTED}`);
    expect(JSON.stringify(out)).not.toContain('Bearer');
  });
});

describe('scrubEvent identity handling (SC-E05)', () => {
  it('keeps the user id and drops email and IP', () => {
    const out = scrubEvent({
      user: { id: '01J8XABCDEF', email: 'nurse@trust.nhs.uk', ip_address: '10.0.0.4' },
    });
    expect(out.user).toEqual({ id: '01J8XABCDEF' });
  });

  it('yields an empty user rather than undefined when there is no id', () => {
    expect(scrubEvent({ user: { email: 'x@y.z' } }).user).toEqual({});
  });
});

describe('scrubEvent breadcrumbs (SC-E06, SC-E07)', () => {
  it('redacts navigation and fetch URLs, and drops fetch bodies', () => {
    const out = scrubEvent({
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/s/tok111', to: '/s/tok222/accept' },
        },
        {
          category: 'fetch',
          data: {
            method: 'POST',
            status_code: 500,
            url: '/api/trpc/incidents.create?batch=1',
            body: '{"title":"assault on ward 4"}',
          },
        },
      ],
    });
    expect(out.breadcrumbs?.[0]?.data).toEqual({
      from: `/s/${REDACTED}`,
      to: `/s/${REDACTED}/accept`,
    });
    expect(out.breadcrumbs?.[1]?.data).toEqual({
      method: 'POST',
      status_code: 500,
      url: '/api/trpc/incidents.create',
    });
    expect(JSON.stringify(out)).not.toContain('assault');
  });

  it('drops console and log breadcrumb messages entirely (SC-E07)', () => {
    const out = scrubEvent({
      breadcrumbs: [{ category: 'console', message: 'patient A. Nurse admitted' }],
    });
    expect(out.breadcrumbs?.[0]?.message).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('A. Nurse');
  });
});

describe('scrubEvent extras, contexts and tags (SC-E08, SC-E09)', () => {
  it('removes extra wholesale and keeps only known-safe contexts', () => {
    const out = scrubEvent({
      extra: { tRPCInput: { description: 'confidential narrative' } },
      contexts: {
        trace: { trace_id: 'abc' },
        runtime: { name: 'node' },
        state: { reduxState: { incident: { narrative: 'confidential narrative' } } },
      },
    });
    expect(out.extra).toBeUndefined();
    expect(Object.keys(out.contexts ?? {}).sort()).toEqual(['runtime', 'trace']);
    expect(JSON.stringify(out)).not.toContain('confidential narrative');
  });

  it('keeps only allowlisted tags (SC-E09)', () => {
    const out = scrubEvent({
      tags: {
        tenantId: '01J8TENANT',
        procedure: 'incidents.create',
        brand: 'freehs',
        reporterEmail: 'nurse@trust.nhs.uk',
        patientName: 'A. Nurse',
      },
    });
    expect(out.tags).toEqual({
      tenantId: '01J8TENANT',
      procedure: 'incidents.create',
      brand: 'freehs',
    });
  });

  it('keeps app_runtime, and does not rely on the SDK-owned runtime tag (SC-E10)', () => {
    // Sentry derives `runtime` at ingest from contexts.runtime and that
    // value wins, so our own process label has to live under a key the SDK
    // does not own. Verified against a real production event: a custom
    // `runtime` tag was replaced by `node v22.19.0`.
    const out = scrubEvent({
      tags: { app_runtime: 'worker', runtime: 'node v22.19.0', queue: 'forma360-incident-alert' },
    });
    expect(out.tags).toEqual({
      app_runtime: 'worker',
      runtime: 'node v22.19.0',
      queue: 'forma360-incident-alert',
    });
  });

  it('never drops the event itself — a hidden error is worse than a thin one', () => {
    const out = scrubEvent({ request: { url: '/x', data: { a: 1 } } });
    expect(out).not.toBeNull();
    expect(out.request?.url).toBe('/x');
  });

  it('does not mutate the input event', () => {
    const event: ScrubbableEvent = { request: { url: '/s/tok', data: { secret: 1 } } };
    scrubEvent(event);
    expect(event.request?.data).toEqual({ secret: 1 });
    expect(event.request?.url).toBe('/s/tok');
  });
});
