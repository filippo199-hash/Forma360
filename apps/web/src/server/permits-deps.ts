/**
 * Real wiring for the permits router (FreeHS module B3). Brand-gates the
 * module per ADR 0010 — the API surface matches the navigation — and
 * provides the PDF renderer for the postable permit record (HSE review
 * PW-6).
 */
import type { PermitsRouterDeps } from '@forma360/api';
import { renderPermitPdf } from '@forma360/render';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';
import { db } from './db';
import { env } from './env';
import { logger } from './logger';
import { storage } from './storage';

const renderLog = logger.child({ component: 'render-permit-pdf' });

export const permitsDeps: PermitsRouterDeps = {
  enabled: brandHasModule(activeBrand.id, 'permits'),
  renderPdf: (input) =>
    renderPermitPdf(
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
