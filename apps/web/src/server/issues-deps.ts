/**
 * Real wiring for the issues tRPC router. Provides the templated-email
 * dispatcher (issue-created notifications), the request logger and
 * APP_URL.
 */
import type { IssuesRouterDeps } from '@forma360/api';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

export const issuesDeps: IssuesRouterDeps = {
  sendEmail: sendTemplatedEmail,
  logger: logger.child({ component: 'issues-router' }),
  appUrl: env.APP_URL,
  storage,
};
