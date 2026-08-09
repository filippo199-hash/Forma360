/**
 * Speech-to-text for the dashboard chats (ADR 0018).
 *
 * Generalises the WhatsApp voice-note pipeline: the browser records a
 * short clip, posts it here as base64, and gets the transcript back to
 * drop into the chat input. Reuses `transcribeAudio` (OpenAI Whisper,
 * gated on OPENAI_API_KEY) — all reasoning stays on Claude; this only
 * turns speech into text.
 *
 * GET reports availability so the UI can hide the mic button instead of
 * failing on first use.
 */
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { tenants } from '@forma360/db/schema';
import { settingsHaveEntitlement } from '@forma360/shared/entitlements';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { isTranscriptionConfigured, transcribeAudio } from '../../../../src/server/transcribe';

/** ~7.5 MB of audio (10 MB base64) — minutes of speech, far beyond a prompt. */
const MAX_BASE64_LENGTH = 10_000_000;

const bodySchema = z.object({
  audio: z.string().min(1).max(MAX_BASE64_LENGTH),
  mimeType: z.string().min(1).max(100),
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Voice input exists only for the dashboard builder chats, so it carries
 * the same gate: the customDashboards entitlement + analytics.create (or
 * admin). Returns whether the caller may transcribe — the mic button
 * hides on false, so a non-entitled tenant never sees it.
 */
async function canTranscribe(tenantId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!settingsHaveEntitlement(rows[0]?.settings, 'customDashboards')) return false;
  const permissions = await loadUserPermissions(db, tenantId, userId);
  return grantsAdminAccess(permissions) || permissions.includes('analytics.create');
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  const allowed = typeof tenantId === 'string' && (await canTranscribe(tenantId, session.user.id));
  return jsonResponse(200, { available: allowed && isTranscriptionConfigured() });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  if (typeof tenantId !== 'string' || !(await canTranscribe(tenantId, session.user.id))) {
    return jsonResponse(403, { error: 'Forbidden' });
  }

  if (!isTranscriptionConfigured()) {
    return jsonResponse(503, { error: 'transcription-unavailable' });
  }

  const rl = await rateLimit(`ai:transcribe:${session.user.id}`, { limit: 20, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonResponse(400, { error: 'Bad request' });

  const text = await transcribeAudio(body.data.audio, body.data.mimeType);
  if (text === null) {
    return jsonResponse(422, { error: 'transcription-failed' });
  }
  return jsonResponse(200, { text });
}
