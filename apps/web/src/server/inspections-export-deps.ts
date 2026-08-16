/**
 * Real wiring for the inspections-export router — R2-backed CSV upload.
 * Imported by every route handler that builds the app router so it sees
 * a router with production-grade storage + a real wall-clock.
 */
import type { InspectionsExportDeps } from '@forma360/api';
import { storage } from './storage';

export const inspectionsExportDeps: InspectionsExportDeps = {
  uploadCsv: async ({ key, body }) => {
    // Store the CSV directly (see Storage.putObject — pre-signing an upload
    // we perform ourselves is what R2 was rejecting). The signed DOWNLOAD
    // URL is still pre-signed: that one is handed to the browser.
    await storage.putObject({
      key,
      contentType: 'text/csv; charset=utf-8',
      bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body,
    });
    const downloadUrl = await storage.getSignedDownloadUrl({ key });
    return { url: downloadUrl };
  },
  now: () => new Date(),
};
