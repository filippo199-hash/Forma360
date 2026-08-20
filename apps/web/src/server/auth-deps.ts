/**
 * Real wiring for the auth tRPC router. Provides the templated-email
 * dispatcher (Resend in prod, pino-console in dev), the request logger
 * and APP_URL — none of which the API package can reach itself.
 */
import type { AuthRouterDeps } from '@forma360/api';
import { getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { isPasswordBreached } from '@forma360/shared/password-breach';
import { env } from './env';
import { logger } from './logger';

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

export const authDeps: AuthRouterDeps = {
  sendEmail: sendTemplatedEmail,
  logger: logger.child({ component: 'auth-router' }),
  appUrl: env.APP_URL,
  checkPasswordBreached: (password) =>
    isPasswordBreached(password, { logger: logger.child({ component: 'password-breach' }) }),
};
