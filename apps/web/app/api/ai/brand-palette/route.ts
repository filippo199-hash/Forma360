/**
 * Brand-palette extraction endpoint (ADR 0018).
 *
 * POST { url } → { palette, logoCandidates } — fetches the (SSRF-guarded)
 * company website, harvests candidate colours and logo image URLs, and asks
 * Claude to compose an accessible palette. The palette is NOT saved here: the client shows a preview and
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
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  harvestSiteColors,
  proposeBrandPalette,
  SiteFetchError,
  UrlRefusedError,
} from '../../../../src/server/brand-palette';
import { fetchDeps } from '../../../../src/server/guarded-fetch';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

const MODEL = 'claude-opus-5';

const bodySchema = z.object({
  url: z.string().url().max(2048).startsWith('https://'),
});

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
      {
        host: new URL(harvest.finalUrl).hostname,
        candidates: harvest.candidates.length,
        logos: harvest.logoCandidates.length,
      },
      '[brand-palette] harvested',
    );

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const palette = await proposeBrandPalette(client, MODEL, {
      url: harvest.finalUrl,
      title: harvest.title,
      candidates: harvest.candidates,
    });
    // The logo the admin most likely wants is on the page they just gave
    // us; making them go and find the file is busywork.
    return NextResponse.json({ palette, logoCandidates: harvest.logoCandidates });
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
