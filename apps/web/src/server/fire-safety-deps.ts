/**
 * Real wiring for the fireSafety router (FreeHS module B4). Brand-gates
 * the module per ADR 0010, provides the FRA PDF renderer (HSE review
 * FS-5) and the escalation-email dispatcher for intolerable
 * assessments (FS-6).
 */
import type { FireSafetyRouterDeps } from '@forma360/api';
import { renderFraPdf } from '@forma360/render';
import { brandHasModule, getBrand } from '@forma360/shared/brand';
import { createSendTemplatedEmail } from '@forma360/shared/email';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { holdRenderedBytes } from './render-fallback';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-fra-pdf' });

const sendTemplatedEmail = createSendTemplatedEmail({
  delivery: env.EMAIL_DELIVERY,
  productName: getBrand(env.BRAND).name,
  ...(env.EMAIL_DELIVERY === 'resend'
    ? { resendApiKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
    : {}),
  logger: logger.child({ component: 'email-templated' }),
});

export const fireSafetyDeps: FireSafetyRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'fireSafety'),
  appUrl: env.APP_URL,
  renderPdf: (input) =>
    renderFraPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        onUploadFailure: holdRenderedBytes,
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
  sendAlertEmail: sendTemplatedEmail,
};
