/**
 * Real wiring for the users tRPC router's email dispatch (invite flow).
 * Called once at module load to populate the side-channel `usersDeps`
 * inside `@forma360/api/src/routers/users`. The router itself is a
 * singleton — this is the analog of the per-request `authDeps` factory.
 */
import { setContractorsRouterDeps, setUsersRouterDeps } from '@forma360/api';
import { whatsappOptOuts } from '@forma360/db/schema';
import { getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { sendWhatsAppTemplate } from './whatsapp';

/**
 * Name and language of the approved template used to greet a number the
 * moment someone connects it in their profile.
 *
 * It has to be a template, not free-form text: the person has not messaged
 * us, so no 24-hour window is open. Until Meta approves it the send simply
 * fails and returns false — which is why the caller treats this as a
 * courtesy, never a precondition.
 */
const WELCOME_TEMPLATE = { name: 'phone_connected', language: 'en' } as const;

/**
 * Greet a newly-connected number. Returns false (quietly) when WhatsApp isn't
 * configured, the template isn't approved yet, or the person has opted out.
 */
async function sendWhatsAppWelcome(phone: string, firstName: string): Promise<boolean> {
  // Meta addresses recipients as bare digits, exactly as it delivers them on
  // the webhook — the stored value keeps a leading `+`.
  const digits = phone.replace(/\D/g, '');
  if (digits === '') return false;

  // Honour STOP. Someone who opted out must not be pulled back in by editing
  // their own profile — that is precisely the re-engagement the policy
  // forbids, and the opt-out list is keyed on the bare number.
  const [optedOut] = await db
    .select({ phone: whatsappOptOuts.phone })
    .from(whatsappOptOuts)
    .where(eq(whatsappOptOuts.phone, digits))
    .limit(1);
  if (optedOut !== undefined) {
    logger.info({ module: 'whatsapp' }, 'Skipped welcome: number has opted out');
    return false;
  }

  return sendWhatsAppTemplate(digits, WELCOME_TEMPLATE.name, WELCOME_TEMPLATE.language, [
    firstName || 'there',
  ]);
}

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-users' }),
});

setUsersRouterDeps({
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
  sendWhatsAppWelcome,
});

// Phase 4 — external contractor portal invites reuse the same invite email.
setContractorsRouterDeps({
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
  productName: getBrand(env.BRAND).name,
});
