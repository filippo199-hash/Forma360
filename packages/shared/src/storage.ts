/**
 * Object storage helpers for Cloudflare R2.
 *
 * R2 is S3-compatible; we use the AWS SDK with the R2 endpoint and region
 * "auto". The signed-URL helpers return pre-signed S3 URLs clients can use
 * to upload or download a single object without handling our credentials.
 *
 * Key convention: `<tenant_id>/<module>/<entity_id>/<filename>`. Every
 * object is scoped by tenant id so a mis-configured CDN rule cannot serve
 * cross-tenant data. Helpers below (`objectKey`, `objectKeyRegex`) build and
 * validate keys against this convention.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { isId, type Id } from './id';

// ─── Key convention ─────────────────────────────────────────────────────────

/**
 * Matches a valid object key: four slash-separated segments.
 *   1. tenant_id — 26-char ULID
 *   2. module — kebab-case lowercase alphanumerics
 *   3. entity_id — 26-char ULID
 *   4. filename — safe filename characters only
 */
const objectKeyRegex =
  /^[0-9A-HJKMNP-TV-Z]{26}\/[a-z][a-z0-9-]*\/[0-9A-HJKMNP-TV-Z]{26}\/[A-Za-z0-9._-]+$/;

export const objectKeySchema = z
  .string()
  .regex(objectKeyRegex, {
    message: 'Object key must be "<tenantId>/<module>/<entityId>/<filename>"',
  })
  .describe('Forma360 R2 object key');

export interface ObjectKeyParts {
  tenantId: Id;
  /** Module name, e.g. "inspections", "issues", "documents". */
  module: string;
  entityId: Id;
  /**
   * File name as the user sees it. Whitespace and unsafe characters will
   * cause this helper to throw; upstream should sanitise before calling.
   */
  filename: string;
}

/** Build an R2 object key from its parts. Throws if any part is malformed. */
export function objectKey(parts: ObjectKeyParts): string {
  if (!isId(parts.tenantId)) {
    throw new Error(`Invalid tenantId: ${parts.tenantId}`);
  }
  if (!isId(parts.entityId)) {
    throw new Error(`Invalid entityId: ${parts.entityId}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(parts.module)) {
    throw new Error(`Invalid module: ${parts.module}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(parts.filename)) {
    throw new Error(`Invalid filename: ${parts.filename}`);
  }
  return `${parts.tenantId}/${parts.module}/${parts.entityId}/${parts.filename}`;
}

/** Type guard for an already-built key. */
export function isObjectKey(key: unknown): key is string {
  return typeof key === 'string' && objectKeyRegex.test(key);
}

// ─── S3 client configuration ────────────────────────────────────────────────

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Build an S3 client configured for Cloudflare R2. Exposed so integration
 * tests can construct their own client without going through the singleton.
 */
export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 does not support the bucket-in-subdomain URL style S3 uses by default.
    forcePathStyle: true,
    /**
     * ST-E07 — every upload in the product 403'd with `SignatureDoesNotMatch`
     * until this line existed, and the message sent everyone hunting for a
     * mis-pasted secret. The credential was fine.
     *
     * AWS SDK v3 ≥ 3.729 computes a request checksum by default. When the
     * command is *pre-signed* rather than sent, that default puts
     * `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` into the
     * signed URL — and the CRC32 it commits to is the checksum of an EMPTY
     * body, because at signing time there is no body. Every object we store
     * then contradicts the URL that was signed for it, and R2 answers the
     * mismatch with `SignatureDoesNotMatch`: a signing fault reported as a
     * credentials fault.
     *
     * Our dependency floats (`^3.720.0`), so the codebase acquired this the
     * day the lockfile resolved past 3.729 — no source change, no deploy,
     * uploads simply stopped.
     *
     * `WHEN_REQUIRED` keeps checksums for operations that mandate them and
     * keeps them out of pre-signed URLs, which a browser (or our own
     * `fetch`) cannot satisfy. `storage.test.ts` pins both URL shapes.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// ─── Storage facade ─────────────────────────────────────────────────────────

export interface Storage {
  /**
   * Store bytes we already hold, signed and sent by the SDK in one request.
   *
   * This is what every SERVER-side upload should use. The routes used to ask
   * for a pre-signed URL and then `fetch` that URL themselves — a pointless
   * round trip that also put the request's correctness at the mercy of
   * whatever the presigner chose to encode in the URL. R2 rejected those
   * pre-signed PUTs with `SignatureDoesNotMatch` while a direct upload with
   * the very same credentials succeeded (the nightly pg_dump never stopped
   * working), which is what proved the credentials innocent.
   *
   * Reserve `getSignedUploadUrl` for a URL handed to somebody ELSE — a
   * browser uploading straight to R2.
   */
  putObject: (input: { key: string; contentType: string; bytes: Uint8Array }) => Promise<void>;

  /** Pre-signed URL for a `PUT` upload. Caller must use the same contentType. */
  getSignedUploadUrl: (input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }) => Promise<string>;

  /**
   * Pre-signed URL for a `GET` download. `responseContentType` /
   * `responseContentDisposition` override the headers R2 returns (e.g. force
   * `inline` + `application/pdf` so a browser renders a PDF instead of
   * downloading it, regardless of how the object was stored).
   */
  getSignedDownloadUrl: (input: {
    key: string;
    expiresInSeconds?: number;
    responseContentType?: string;
    responseContentDisposition?: string;
  }) => Promise<string>;

  /** Delete an object. Idempotent — succeeds if the key is already absent. */
  deleteObject: (input: { key: string }) => Promise<void>;
}

/**
 * Default expiry for signed URLs: 15 minutes. Long enough for a user to
 * pick a large file and upload over a mediocre connection, short enough
 * that a leaked URL stops working quickly.
 */
export const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 60 * 15;

/**
 * Build a Storage facade from R2 config. No connections are opened until
 * the first method is called — `createR2Client` merely constructs the
 * S3Client object; AWS SDK clients connect lazily.
 */
export function createStorage(config: R2Config): Storage {
  const client = createR2Client(config);
  const { bucket } = config;

  return {
    async putObject({ key, contentType, bytes }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.byteLength,
        }),
      );
    },

    async getSignedUploadUrl({
      key,
      contentType,
      expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
    }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    async getSignedDownloadUrl({
      key,
      expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
      responseContentType,
      responseContentDisposition,
    }) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(responseContentType !== undefined ? { ResponseContentType: responseContentType } : {}),
        ...(responseContentDisposition !== undefined
          ? { ResponseContentDisposition: responseContentDisposition }
          : {}),
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    async deleteObject({ key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
