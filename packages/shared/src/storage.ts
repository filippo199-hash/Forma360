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
import { isId, type Id } from './id.js';

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
  });
}

// ─── Storage facade ─────────────────────────────────────────────────────────

export interface Storage {
  /** Pre-signed URL for a `PUT` upload. Caller must use the same contentType. */
  getSignedUploadUrl: (input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }) => Promise<string>;

  /** Pre-signed URL for a `GET` download. */
  getSignedDownloadUrl: (input: { key: string; expiresInSeconds?: number }) => Promise<string>;

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

    async getSignedDownloadUrl({ key, expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES_SECONDS }) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    async deleteObject({ key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
