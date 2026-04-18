/**
 * Real wiring for the inspections-export router — R2-backed CSV upload.
 * Imported by every route handler that builds the app router so it sees
 * a router with production-grade storage + a real wall-clock.
 */
import type { InspectionsExportDeps } from '@forma360/api';
import { storage } from './storage';

export const inspectionsExportDeps: InspectionsExportDeps = {
  uploadCsv: async ({ key, body }) => {
    // Pre-sign an upload URL and PUT the CSV body. The returned signed
    // download URL is what the client uses to fetch the export.
    const uploadUrl = await storage.getSignedUploadUrl({
      key,
      contentType: 'text/csv; charset=utf-8',
    });
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body,
    });
    if (!res.ok) {
      throw new Error(`CSV upload failed: ${res.status} ${res.statusText}`);
    }
    const downloadUrl = await storage.getSignedDownloadUrl({ key });
    return { url: downloadUrl };
  },
  now: () => new Date(),
};
