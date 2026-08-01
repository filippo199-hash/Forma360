/**
 * Real wiring for the inspections tRPC router. Provides the
 * templated-email dispatcher (signature-workflow-request /
 * signature-workflow-complete emails), the request logger and APP_URL.
 */
import type { InspectionsRouterDeps } from '@forma360/api';
import { getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
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

export const inspectionsDeps: InspectionsRouterDeps = {
  sendEmail: sendTemplatedEmail,
  logger: logger.child({ component: 'inspections-router' }),
  appUrl: env.APP_URL,
};
