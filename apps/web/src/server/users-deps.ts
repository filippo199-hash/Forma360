/**
 * Real wiring for the users tRPC router's email dispatch (invite flow).
 * Called once at module load to populate the side-channel `usersDeps`
 * inside `@forma360/api/src/routers/users`. The router itself is a
 * singleton — this is the analog of the per-request `authDeps` factory.
 */
import { setContractorsRouterDeps, setUsersRouterDeps } from '@forma360/api';
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
  logger: logger.child({ component: 'email-users' }),
});

setUsersRouterDeps({
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
});

// Phase 4 — external contractor portal invites reuse the same invite email.
setContractorsRouterDeps({
  sendEmail: sendTemplatedEmail,
  appUrl: env.APP_URL,
  productName: getBrand(env.BRAND).name,
});
