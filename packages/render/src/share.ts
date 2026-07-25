/**
 * Public-share-link primitives for Phase 2 PR 31.
 *
 * A share link is an opaque, URL-safe token (32 random bytes →
 * base64url, 43 chars no padding) stored in `public_inspection_links`.
 * The token is the only secret: possession = read access to the single
 * inspection referenced by the row, until the row expires or is
 * revoked. No session, no cookie, no tenant context on the wire.
 *
 *   - {@link generateShareToken}  — build a fresh token.
 *   - {@link validateShareToken}  — check a token against the DB,
 *     returning `{ inspectionId, tenantId }` for a valid row or `null`
 *     for expired / revoked / unknown tokens.
 *
 * See ADR 0008.
 */
import { headsUps, publicInspectionLinks } from '@forma360/db/schema';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@forma360/db/client';

/** Number of random bytes per token. 32 bytes → 43-char base64url. */
export const SHARE_TOKEN_BYTES = 32;

/**
 * Build a fresh opaque share token.
 *
 * Uses Node's `crypto.randomBytes`; base64url (RFC 4648 §5) so the token
 * slots into a URL path segment without percent-encoding.
 */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/** What `validateShareToken` hands back on a successful lookup. */
export interface ShareTokenClaims {
  /** Row id (ULID). */
  linkId: string;
  /** The inspection the token grants read-access to. */
  inspectionId: string;
  /** Owning tenant — callers must use this when querying sibling tables. */
  tenantId: string;
}

/**
 * Look up a token and verify it is still redeemable. Returns null on:
 *   - unknown token
 *   - `expiresAt` is non-null and in the past
 *   - `revokedAt` is non-null
 *
 * `now` is injected so tests can assert expiry behaviour deterministically.
 */
export async function validateShareToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ShareTokenClaims | null> {
  // Tokens have a fixed shape; a length mismatch can never match a real
  // row and skipping the DB round-trip avoids a timing-side-channel where
  // the length of the submitted token changes query latency.
  // 32 random bytes → 43 chars of base64url without padding.
  if (typeof token !== 'string' || token.length !== 43) return null;

  const rows = await db
    .select({
      id: publicInspectionLinks.id,
      tenantId: publicInspectionLinks.tenantId,
      inspectionId: publicInspectionLinks.inspectionId,
      expiresAt: publicInspectionLinks.expiresAt,
      revokedAt: publicInspectionLinks.revokedAt,
    })
    .from(publicInspectionLinks)
    .where(eq(publicInspectionLinks.token, token))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return null;
  return {
    linkId: row.id,
    inspectionId: row.inspectionId,
    tenantId: row.tenantId,
  };
}

/** What `validateHeadsUpShareToken` hands back on a successful lookup. */
export interface HeadsUpShareClaims {
  /** Owning tenant — callers must use this when querying sibling tables. */
  tenantId: string;
  /** The heads-up the token grants read-access to. */
  headsUpId: string;
  title: string;
  description: string | null;
  engagementLevel: string;
  createdByUserId: string;
  status: string;
}

/**
 * Look up a heads-up share token and verify it grants read access.
 *
 * Heads-up tokens are 32 hex chars stored on `heads_ups.share_token`
 * (unique); revoking nulls the column. Returns null on:
 *   - wrong-length token (length-gated before any DB hit, symmetry with
 *     {@link validateShareToken})
 *   - unknown token
 *   - a row whose `status` is not `published` (drafts / archived are never
 *     leaked through the public share surface)
 *
 * `now` is accepted for signature symmetry with the other validators; the
 * heads-up token has no time-based expiry of its own.
 */
export async function validateHeadsUpShareToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<HeadsUpShareClaims | null> {
  void now;
  // Heads-up tokens are 32 hex chars; a length mismatch can never match a
  // real row, so skip the DB round-trip (and the timing side-channel).
  if (typeof token !== 'string' || token.length !== 32) return null;

  const rows = await db
    .select({
      tenantId: headsUps.tenantId,
      headsUpId: headsUps.id,
      title: headsUps.title,
      description: headsUps.description,
      engagementLevel: headsUps.engagementLevel,
      createdByUserId: headsUps.createdByUserId,
      status: headsUps.status,
    })
    .from(headsUps)
    .where(eq(headsUps.shareToken, token))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.status !== 'published') return null;
  return {
    tenantId: row.tenantId,
    headsUpId: row.headsUpId,
    title: row.title,
    description: row.description,
    engagementLevel: row.engagementLevel,
    createdByUserId: row.createdByUserId,
    status: row.status,
  };
}

/**
 * Build the absolute public share URL for a token. Helper kept here so
 * the appUrl / "/s/" convention lives in one place.
 */
export function buildShareUrl(appUrl: string, token: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/s/${token}`;
}

/**
 * Internal helper used by the revoke path. Exposed for the router.
 * Idempotent — revoking an already-revoked row is a no-op from the
 * caller's perspective.
 */
export async function revokeShareLinkRow(
  db: Database,
  input: { tenantId: string; linkId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const rows = await db
    .update(publicInspectionLinks)
    .set({ revokedAt: now })
    .where(
      and(
        eq(publicInspectionLinks.tenantId, input.tenantId),
        eq(publicInspectionLinks.id, input.linkId),
      ),
    )
    .returning({ id: publicInspectionLinks.id });
  return rows.length > 0;
}
