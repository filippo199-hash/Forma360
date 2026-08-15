/**
 * ST-E01..E06 — a failed object-store upload must name its cause.
 *
 * The production incident these cover: every distinct R2 rejection
 * surfaced as the string "403 Forbidden", so the log could not tell a
 * mis-pasted secret from a read-only token.
 */
import { describe, expect, it } from 'vitest';
import {
  describeObjectStoreError,
  formatObjectStoreError,
  objectStoreUploadError,
} from './object-store-error';

function res(status: number, statusText: string, body: string | (() => Promise<string>)) {
  return {
    status,
    statusText,
    text: typeof body === 'string' ? async () => body : body,
  };
}

const ACCESS_DENIED = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`;

describe('object-store upload errors', () => {
  it('ST-E01: extracts the S3 error code and message from R2 XML', async () => {
    const d = await describeObjectStoreError(res(403, 'Forbidden', ACCESS_DENIED));
    expect(d).toEqual({
      status: 403,
      statusText: 'Forbidden',
      code: 'AccessDenied',
      detail: 'Access Denied',
    });
  });

  it('ST-E02: the formatted message carries the code, not just the status', async () => {
    const msg = formatObjectStoreError(
      await describeObjectStoreError(res(403, 'Forbidden', ACCESS_DENIED)),
    );
    expect(msg).toBe('R2 upload failed: 403 Forbidden (AccessDenied: Access Denied)');
  });

  it('ST-E03: distinguishes the causes that share a 403', async () => {
    const codes = ['SignatureDoesNotMatch', 'InvalidAccessKeyId', 'AccessDenied'];
    const seen = await Promise.all(
      codes.map(async (code) =>
        formatObjectStoreError(
          await describeObjectStoreError(
            res(403, 'Forbidden', `<Error><Code>${code}</Code></Error>`),
          ),
        ),
      ),
    );
    expect(new Set(seen).size).toBe(3);
    for (const [i, code] of codes.entries()) expect(seen[i]).toContain(code);
  });

  it('ST-E04: degrades to the status line when the body is not XML', async () => {
    const msg = formatObjectStoreError(
      await describeObjectStoreError(res(500, 'Internal Server Error', 'upstream exploded')),
    );
    expect(msg).toBe('R2 upload failed: 500 Internal Server Error');
  });

  it('ST-E05: an unreadable body never masks the original failure', async () => {
    const msg = formatObjectStoreError(
      await describeObjectStoreError(
        res(403, 'Forbidden', async () => {
          throw new Error('body already consumed');
        }),
      ),
    );
    expect(msg).toBe('R2 upload failed: 403 Forbidden');
  });

  it('ST-E06: objectStoreUploadError builds a throwable Error', async () => {
    const err = await objectStoreUploadError(res(403, 'Forbidden', ACCESS_DENIED));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('AccessDenied');
  });
});
