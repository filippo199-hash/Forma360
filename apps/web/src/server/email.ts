import { getBrand } from '@forma360/shared/brand';
import { createSendEmail, createSendTemplatedEmail } from '@forma360/shared/email';
import { env } from './env';
import { logger } from './logger';

const baseConfig = {
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
};

/** Legacy URL-style dispatcher (better-auth verification + reset paths). */
export const sendEmail = createSendEmail({
  ...baseConfig,
  logger: logger.child({ component: 'email' }),
});

/**
 * Templated dispatcher — every new path (auth OTP, invites,
 * request-to-join, schedule reminders, …) renders the
 * `packages/i18n/emails/<locale>/<key>.json` template with a flat
 * variables map.
 */
export const sendTemplatedEmail = createSendTemplatedEmail({
  ...baseConfig,
  logger: logger.child({ component: 'email-templated' }),
});
