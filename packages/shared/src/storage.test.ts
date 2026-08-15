/**
 * Pre-signed URL shape (ST-E07..E09).
 *
 * These assert something a type-checker cannot: that the URL we hand to a
 * browser — or to our own `fetch` — asks for nothing the caller is unable
 * to send.
 *
 * The bug this pins took every upload in the product down at once. AWS SDK
 * v3 ≥ 3.729 turned on default request checksums, so pre-signing a
 * `PutObjectCommand` began embedding `x-amz-checksum-crc32` in the signed
 * URL — computed over an empty body, because a pre-sign has no body. R2
 * rejected the resulting mismatch as `SignatureDoesNotMatch`, which reads
 * as "your secret is wrong" and is why the outage was hunted in the
 * Cloudflare dashboard rather than in this file. Nothing in our source
 * changed; the dependency range floated past the release.
 *
 * A unit test can catch it because the defect is visible in the URL
 * itself, with credentials that need not be real.
 */
import { describe, expect, it } from 'vitest';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { newId } from './id';
import { createR2Client, createStorage, isObjectKey, objectKey } from './storage';

const CONFIG = {
  accountId: 'acct0000000000000000000000000000',
  accessKeyId: 'access-key-id',
  secretAccessKey: 'secret-access-key',
  bucket: 'test-bucket',
};

/** Query parameters SigV4 itself puts on a pre-signed URL. */
const SIGV4_PARAMS =
  /^(X-Amz-(Algorithm|Credential|Date|Expires|SignedHeaders|Signature|Content-Sha256|Security-Token)|x-id|response-.*)$/i;

function extraParams(url: string): string[] {
  return [...new URL(url).searchParams.keys()].filter((k) => !SIGV4_PARAMS.test(k));
}

describe('R2 pre-signed URLs', () => {
  it('ST-E07: an upload URL carries no checksum the uploader cannot satisfy', async () => {
    const url = await createStorage(CONFIG).getSignedUploadUrl({
      key: objectKey({
        tenantId: newId(),
        module: 'assets',
        entityId: newId(),
        filename: 'photo.jpg',
      }),
      contentType: 'image/jpeg',
    });

    // `x-amz-checksum-crc32` here is the checksum of NO bytes — every real
    // upload contradicts it, and R2 reports that as SignatureDoesNotMatch.
    expect(extraParams(url)).toEqual([]);
    expect(url).not.toMatch(/checksum/i);
  });

  it('ST-E08: a download URL carries no checksum mode either', async () => {
    const url = await createStorage(CONFIG).getSignedDownloadUrl({
      key: '01ARZ3NDEKTSV4RRFFQ69G5FAV/assets/01ARZ3NDEKTSV4RRFFQ69G5FAW/photo.jpg',
      responseContentType: 'image/jpeg',
    });

    expect(extraParams(url)).toEqual([]);
    expect(url).not.toMatch(/checksum/i);
  });

  it('ST-E09: the client itself is configured to keep checksums out of signatures', async () => {
    // Guards the config rather than the facade, so a new helper that
    // pre-signs a different command inherits the same protection.
    const client = createR2Client(CONFIG);
    const put = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: CONFIG.bucket, Key: 'k', ContentType: 'text/plain' }),
      { expiresIn: 60 },
    );
    const get = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: CONFIG.bucket, Key: 'k' }),
      { expiresIn: 60 },
    );

    expect(extraParams(put)).toEqual([]);
    expect(extraParams(get)).toEqual([]);
    // Only `host` is signed: anything else must be reproduced byte-for-byte
    // by the caller, which a browser upload cannot promise.
    expect(new URL(put).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('builds and validates keys against the tenant-scoped convention', () => {
    const key = objectKey({
      tenantId: newId(),
      module: 'assets',
      entityId: newId(),
      filename: 'photo.jpg',
    });
    expect(isObjectKey(key)).toBe(true);
    expect(isObjectKey('no-tenant/assets/x/photo.jpg')).toBe(false);
  });
});
