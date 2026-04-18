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
