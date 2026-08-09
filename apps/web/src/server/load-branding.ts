/**
 * Tenant branding, resolved server-side (ADR 0018).
 *
 * Same shape as `load-sandbox-state.ts` beside it: the signed-in layout
 * calls {@link loadTenantBranding} once per request to (a) build the
 * inline tenant-theme `<style>` and (b) hand the sidebar a renderable
 * logo URL. `loadTenantBrandingById` is the sessionless variant for the
 * print/render surfaces, which know their tenant id from the record they
 * are rendering.
 *
 * Logo URL resolution mirrors the settings preview: in production the R2
 * key is exchanged for a signed download URL; in dev the company-logo GET
 * route streams the bytes out of `.local-storage` (session-gated, which
 * the browser satisfies with its cookie).
 */
import { tenants, type TenantBranding } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { auth } from './auth';
import { db } from './db';
import { env } from './env';
import { storage } from './storage';

export interface TenantBrandingState {
  branding: TenantBranding | null;
  /** Resolved logo URL, or null when no logo is set / signing failed. */
  logoUrl: string | null;
}

const EMPTY: TenantBrandingState = { branding: null, logoUrl: null };

/** Branding for the current session's tenant; empty when signed out. */
export async function loadTenantBranding(): Promise<TenantBrandingState> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const tenantId = session?.user.tenantId;
  if (typeof tenantId !== 'string') return EMPTY;
  return loadTenantBrandingById(tenantId);
}

/** Branding for a known tenant id (print/render surfaces, no session). */
export async function loadTenantBrandingById(tenantId: string): Promise<TenantBrandingState> {
  const rows = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const branding = rows[0]?.settings.branding;
  if (branding === undefined) return EMPTY;
  return { branding, logoUrl: await resolveCompanyLogoUrl(branding.logoStorageKey) };
}

async function resolveCompanyLogoUrl(key: string | undefined): Promise<string | null> {
  if (key === undefined || key === '') return null;
  if (env.NODE_ENV !== 'production') {
    return `/api/upload/company-logo?key=${encodeURIComponent(key)}`;
  }
  try {
    return await storage.getSignedDownloadUrl({ key });
  } catch {
    return null;
  }
}
