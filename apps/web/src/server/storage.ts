/**
 * Shared R2 storage singleton for server-side consumers (the exports
 * router, the upload route, future renderers). Built lazily on first
 * access so importing the module on the client side doesn't open an
 * S3 client.
 */
import { createStorage, type Storage } from '@forma360/shared/storage';
import { env } from './env';

let instance: Storage | null = null;

function getStorage(): Storage {
  if (instance !== null) return instance;
  instance = createStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  return instance;
}

// Re-export the lazily-built client behind a property accessor so the
// first access builds it. Downstream consumers call methods on this
// object exactly as they would on `createStorage(...)`'s return.
export const storage: Storage = new Proxy({} as Storage, {
  get(_t, prop: keyof Storage) {
    const s = getStorage();
    return s[prop];
  },
});

/**
 * Write bytes we already hold in memory to `key`.
 *
 * The upload routes take a browser `File` and stream it; this is the
 * server-side equivalent for blobs that never touched a form — currently
 * WhatsApp media, which arrives base64 from Meta's Graph API. Same
 * production/dev split as the routes: a signed PUT against R2 in production,
 * `.local-storage/<key>` otherwise, so a dev machine needs no bucket.
 *
 * Throws on failure; callers decide whether that is fatal.
 */
export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (env.NODE_ENV === 'production') {
    const uploadUrl = await storage.getSignedUploadUrl({ key, contentType });
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      // Copy into a fresh ArrayBuffer: a Uint8Array view over a SharedArrayBuffer
      // is not a BlobPart under this lib config, and Buffer views can be.
      body: new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType }),
      headers: { 'content-type': contentType },
    });
    if (!res.ok) throw new Error(`R2 PUT failed with ${res.status}`);
    return;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const target = join(process.cwd(), '.local-storage', key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/**
 * Resolve a template branding logo storage key into a fetchable URL.
 * Returns `null` when the key is empty or the signed URL fails. In
 * development, where R2 isn't available, we point the caller at the
 * dev-only `GET /api/upload/template-logo/signed-url` handler which
 * streams the file out of `.local-storage/<key>`.
 */
export async function fetchLogoUrl(key: string | undefined): Promise<string | null> {
  if (key === undefined || key === '') return null;
  if (env.NODE_ENV !== 'production') {
    return `/api/upload/template-logo/signed-url?key=${encodeURIComponent(key)}`;
  }
  try {
    return await getStorage().getSignedDownloadUrl({ key });
  } catch {
    return null;
  }
}
