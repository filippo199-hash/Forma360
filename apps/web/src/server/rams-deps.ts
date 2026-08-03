/**
 * Real wiring for the RAMS router (FreeHS module B6). Brand-gates the
 * module per ADR 0010, provides the pack PDF renderer and the opaque
 * share-token helpers behind the client-issue surface.
 */
import type { RamsRouterDeps } from '@forma360/api';
import { buildShareUrl, generateShareToken, renderRamsPdf } from '@forma360/render';
import { brandHasModule, getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-rams-pdf' });

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

export const ramsDeps: RamsRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'rams'),
  appUrl: env.APP_URL,
  generateShareToken,
  buildShareUrl: (token) => buildShareUrl(env.APP_URL, token),
  sendEmail: sendTemplatedEmail,
  renderPdf: (input) =>
    renderRamsPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
};
