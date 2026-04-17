/**
 * Manual R2 round-trip script.
 *
 * Usage (from the repo root):
 *   pnpm --filter @forma360/shared test:r2
 *
 * Requires a valid .env with R2_* credentials pointing at a real bucket.
 * The script:
 *   1. builds a random key under a synthetic tenant namespace,
 *   2. PUTs a small payload via a signed upload URL,
 *   3. GETs it back via a signed download URL and asserts equality,
 *   4. deletes the object,
 *   5. confirms the subsequent GET returns 404.
 *
 * Intentionally not a Vitest integration test: real R2 calls are slow,
 * flaky in CI without credentials, and billed per operation.
 */
import { parseServerEnv } from '../src/env.js';
import { newId } from '../src/id.js';
import { createStorage, objectKey } from '../src/storage.js';

async function main(): Promise<void> {
  const env = parseServerEnv();
  const storage = createStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });

  const key = objectKey({
    tenantId: newId(),
    module: 'smoke-test',
    entityId: newId(),
    filename: 'roundtrip.txt',
  });

  const payload = `forma360 r2 smoke test @ ${new Date().toISOString()}`;
  const contentType = 'text/plain';

  console.log(`[r2] key    = ${key}`);
  console.log(`[r2] bytes  = ${payload.length}`);

  // 1. Upload via signed URL.
  const uploadUrl = await storage.getSignedUploadUrl({ key, contentType });
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: payload,
  });
  if (!putResponse.ok) {
    throw new Error(`PUT failed: ${putResponse.status} ${await putResponse.text()}`);
  }
  console.log('[r2] upload ✓');

  // 2. Download via signed URL and assert equality.
  const downloadUrl = await storage.getSignedDownloadUrl({ key });
  const getResponse = await fetch(downloadUrl);
  if (!getResponse.ok) {
    throw new Error(`GET failed: ${getResponse.status} ${await getResponse.text()}`);
  }
  const body = await getResponse.text();
  if (body !== payload) {
    throw new Error(`Round-trip mismatch: got ${body.length} bytes, expected ${payload.length}`);
  }
  console.log('[r2] download ✓');

  // 3. Delete + confirm 404.
  await storage.deleteObject({ key });
  console.log('[r2] delete ✓');

  const postDeleteUrl = await storage.getSignedDownloadUrl({ key });
  const postDeleteResponse = await fetch(postDeleteUrl);
  if (postDeleteResponse.status !== 404) {
    throw new Error(
      `Post-delete GET should 404, got ${postDeleteResponse.status}. Bucket might have delay or caching.`,
    );
  }
  console.log('[r2] 404-after-delete ✓');

  console.log('\nAll good.');
}

main().catch((err) => {
  console.error('[r2] smoke test failed:', err);
  process.exitCode = 1;
});
