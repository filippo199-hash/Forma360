/**
 * Real wiring for the exports router — PDF / Word renderers + share
 * URL helpers. Imported by the tRPC route handler so every request
 * sees a router bound to real R2-backed storage + a real HMAC secret.
 */
import type { ExportsRouterDeps } from '@forma360/api';
import {
  renderInspectionPdf,
  renderInspectionDocx,
  generateShareToken,
  buildShareUrl,
} from '@forma360/render';
import { env } from './env';
import { db } from './db';
import { holdRenderedBytes } from './render-fallback';
import { storage } from './storage';
import { logger } from './logger';

const renderLog = logger.child({ component: 'render-pdf' });

export const exportsDeps: ExportsRouterDeps = {
  renderPdf: async (input) =>
    renderInspectionPdf(
      {
        db,
        storage,
        appUrl: env.APP_URL,
        renderSharedSecret: env.RENDER_SHARED_SECRET,
        // Surface why a render fell back to the stub ("Render engine not
        // configured") — without this the failure reason was dropped.
        onUploadFailure: holdRenderedBytes,
        onLog: (e) => {
          if (e.level === 'warn') renderLog.warn(e.msg);
          else renderLog.info(e.msg);
        },
      },
      input,
    ),
  renderDocx: async (input) =>
    renderInspectionDocx({ db, storage, onUploadFailure: holdRenderedBytes }, input),
  generateShareToken,
  buildShareUrl: (token) => buildShareUrl(env.APP_URL, token),
};
