/**
 * Real wiring for the actions router's notification dispatch (platform
 * HSE review PF-4 — assignment emails). Side-effect module, mirroring
 * `users-deps.ts`: imported once so the singleton router gets its
 * dispatcher.
 */
import { setActionsRouterDeps, setApprovalsRouterDeps } from '@forma360/api';
import { getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { env } from './env';
import { storage } from './storage';
import { logger } from './logger';

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-actions' }),
});

setApprovalsRouterDeps({ sendEmail: sendTemplatedEmail, appUrl: env.APP_URL });

setActionsRouterDeps({
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
  // Signs download URLs for action attachments (photos and files sent to the
  // WhatsApp assistant land here too).
  signDownloadUrl: (key) => storage.getSignedDownloadUrl({ key }),
});
