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
