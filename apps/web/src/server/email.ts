import { createSendEmail } from '@forma360/shared/email';
import { env } from './env';
import { logger } from './logger';

export const sendEmail = createSendEmail({
  delivery: env.EMAIL_DELIVERY,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email' }),
});
