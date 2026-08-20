/**
 * Set or change the signed-in user's password.
 *
 * POST { newPassword, currentPassword? }
 *   - without `currentPassword` → first-password setup for an account
 *     with no credential row (better-auth's server-only `setPassword`;
 *     refuses with 409 when one already exists, so this can never be
 *     used to overwrite a password without knowing it).
 *   - with `currentPassword` → change via better-auth's
 *     `changePassword`, revoking every OTHER session; the one making
 *     the request stays signed in.
 *
 * Always: Zod-validated body, per-user rate limit, the shared fail-open
 * breach check, and a `password-changed` notification to the account
 * inbox so a hijacked session cannot add or change a password silently.
 * Error responses carry `{ code }` for the settings card to translate —
 * never better-auth's raw English message.
 */
import { user as userTable } from '@forma360/db/schema';
import { appLink } from '@forma360/shared/app-link';
import { passwordSchema } from '@forma360/shared/password';
import { isPasswordBreached } from '@forma360/shared/password-breach';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { sendTemplatedEmail } from '../../../../src/server/email';
import { env } from '../../../../src/server/env';
import { logger } from '../../../../src/server/logger';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

const log = logger.child({ component: 'account-password' });

const bodySchema = z.object({
  newPassword: passwordSchema,
  currentPassword: z.string().min(1).max(256).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs }).catch(() => null);
  if (session === null) {
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Keyed by user, not IP: the sensitive resource here is the account,
  // and a session-holder probing `currentPassword` guesses is the threat.
  const rl = await rateLimit(`account:password:${session.user.id}`, {
    limit: 10,
    windowSec: 300,
  });
  if (!rl.ok) {
    return tooManyRequests(rl.retryAfterSec);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { newPassword, currentPassword } = parsed.data;

  if (await isPasswordBreached(newPassword, { logger: log })) {
    return NextResponse.json({ code: 'PASSWORD_COMPROMISED' }, { status: 400 });
  }

  try {
    if (currentPassword !== undefined) {
      await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: hdrs,
      });
    } else {
      await auth.api.setPassword({ body: { newPassword }, headers: hdrs });
    }
  } catch (error) {
    if (error instanceof APIError) {
      const code = typeof error.body?.code === 'string' ? error.body.code : 'ERROR';
      if (code === 'INVALID_PASSWORD' || code === 'INVALID_EMAIL_OR_PASSWORD') {
        return NextResponse.json({ code: 'INVALID_CURRENT_PASSWORD' }, { status: 400 });
      }
      if (code === 'PASSWORD_ALREADY_SET') {
        // Another tab / device set one first — the card refetches and
        // switches to the change form.
        return NextResponse.json({ code: 'PASSWORD_ALREADY_SET' }, { status: 409 });
      }
      log.warn({ code, status: error.status }, '[account-password] refused by auth layer');
      return NextResponse.json({ code }, { status: 400 });
    }
    throw error;
  }

  // Same announcement the reset flow makes (auth server onPasswordReset):
  // a password appearing or changing is never silent. Delivery failure
  // must not roll back a password that is already in place.
  try {
    const rows = await db
      .select({ locale: userTable.locale })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .limit(1);
    const locale = rows[0]?.locale ?? undefined;
    await sendTemplatedEmail({
      to: session.user.email,
      templateKey: 'password-changed',
      variables: { url: appLink(env.APP_URL, locale ?? null, '/sign-in') },
      locale,
    });
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      '[account-password] password-changed notification failed',
    );
  }

  return NextResponse.json({ ok: true });
}
