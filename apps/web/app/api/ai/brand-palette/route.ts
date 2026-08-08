/**
 * Brand-palette extraction endpoint (ADR 0018).
 *
 * POST { url } → { palette } — fetches the (SSRF-guarded) company website,
 * harvests candidate colours, and asks Claude to compose an accessible
 * palette. The palette is NOT saved here: the client shows a preview and
 * the admin persists it via `tenants.updateBranding` after confirming.
 *
 * Gates: session required, `org.settings` (Administrator) required, and a
 * tight per-user rate limit (5 requests / 5 min) — every call costs a
 * model invocation plus outbound fetches.
 *
 * Logging: hostnames and candidate counts only. Fetched website content
 * is never logged.
 */
import Anthropic from '@anthropic-ai/sdk';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { lookup } from 'node:dns/promises';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Agent } from 'undici';
import { z } from 'zod';
import {
  harvestSiteColors,
  isPrivateAddress,
  proposeBrandPalette,
  SiteFetchError,
  UrlRefusedError,
  type FetchDeps,
  type ResolvedAddress,
} from '../../../../src/server/brand-palette';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

const MODEL = 'claude-opus-5';

const bodySchema = z.object({
  url: z.string().url().max(2048).startsWith('https://'),
});

/**
 * Pin the connection to the addresses the guard already validated for this
 * hop, so undici never re-resolves the hostname (the DNS-rebinding TOCTOU).
 * The hostname is preserved for TLS SNI + certificate validation; only DNS
 * is overridden. Each pinned address is re-checked here as defence in depth
 * — if a validated set is somehow private, the connect fails closed.
 */
function pinnedFetch(
  url: string,
  init: RequestInit,
  pin: readonly ResolvedAddress[],
): Promise<Response> {
  const safe = pin.filter((a) => !isPrivateAddress(a.address));
  if (safe.length === 0) {
    return Promise.reject(new Error('no public address to connect to'));
  }
  const dispatcher = new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        cb: (err: Error | null, address: string, family: number) => void,
      ) => {
        const first = safe[0];
        if (first === undefined) {
          cb(new Error('no pinned address'), '', 4);
          return;
        }
        cb(null, first.address, first.family);
      },
    },
  });
  // `dispatcher` is an undici-specific RequestInit extension.
  return fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent }).finally(
    () => void dispatcher.close(),
  );
}

const fetchDeps: FetchDeps = {
  fetch: pinnedFetch,
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }),
};

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  const userId = session.user.id;
  if (typeof tenantId !== 'string') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Branding is an org-level setting — same Administrator gate as
  // tenants.updateBranding, checked server-side before anything is fetched.
  const perms = await loadUserPermissions(db, tenantId, userId);
  if (!grantsAdminAccess(perms)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Cap AI token spend + outbound fetch volume per user.
  const rl = await rateLimit(`ai:brand-palette:${userId}`, { limit: 5, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const log = logger.child({ route: 'ai/brand-palette', tenantId });
  try {
    const harvest = await harvestSiteColors(body.data.url, fetchDeps);
    if (harvest.candidates.length === 0) {
      return NextResponse.json({ error: 'NO_COLORS' }, { status: 422 });
    }
    log.info(
      { host: new URL(harvest.finalUrl).hostname, candidates: harvest.candidates.length },
      '[brand-palette] harvested',
    );

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const palette = await proposeBrandPalette(client, MODEL, {
      url: harvest.finalUrl,
      title: harvest.title,
      candidates: harvest.candidates,
    });
    return NextResponse.json({ palette });
  } catch (err) {
    if (err instanceof UrlRefusedError) {
      // Generic message: never explain to a prober WHICH rule refused it.
      log.warn({ reason: err.message }, '[brand-palette] url refused');
      return NextResponse.json({ error: 'URL_REFUSED' }, { status: 400 });
    }
    if (err instanceof SiteFetchError) {
      log.warn({ reason: err.message }, '[brand-palette] fetch failed');
      return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 422 });
    }
    log.error({ err }, '[brand-palette] proposal failed');
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
