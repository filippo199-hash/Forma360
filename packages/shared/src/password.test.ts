import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPasswordBreached } from './password-breach';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from './password';

/** SHA-1 prefix/suffix split the same way the k-anonymity API expects. */
function sha1Parts(password: string): { prefix: string; suffix: string } {
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

function rangeResponse(lines: string[]): Response {
  return new Response(lines.join('\r\n'), { status: 200 });
}

describe('passwordSchema', () => {
  it(`accepts a ${PASSWORD_MIN_LENGTH}-character password`, () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it('rejects one character below the minimum', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
  });

  it('rejects one character above the maximum', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('isPasswordBreached', () => {
  it('returns true when the suffix appears with a positive count', async () => {
    const { suffix } = sha1Parts('correct horse battery staple');
    const fetchImpl: typeof fetch = async () =>
      rangeResponse(['0000000000000000000000000000000000A:12', `${suffix}:57`]);
    await expect(isPasswordBreached('correct horse battery staple', { fetchImpl })).resolves.toBe(
      true,
    );
  });

  it('queries the API with the 5-char prefix only (k-anonymity)', async () => {
    const { prefix } = sha1Parts('a very private password');
    let requestedUrl = '';
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return rangeResponse([]);
    };
    await isPasswordBreached('a very private password', { fetchImpl });
    expect(requestedUrl.endsWith(`/range/${prefix}`)).toBe(true);
    expect(requestedUrl).not.toContain(sha1Parts('a very private password').suffix);
  });

  it('treats a zero count as NOT breached (Add-Padding entries)', async () => {
    const { suffix } = sha1Parts('padded entry password');
    const fetchImpl: typeof fetch = async () => rangeResponse([`${suffix}:0`]);
    await expect(isPasswordBreached('padded entry password', { fetchImpl })).resolves.toBe(false);
  });

  it('returns false when the suffix is absent from the range', async () => {
    const fetchImpl: typeof fetch = async () =>
      rangeResponse(['0000000000000000000000000000000000A:12']);
    await expect(isPasswordBreached('unlisted password!!', { fetchImpl })).resolves.toBe(false);
  });

  it('matches the suffix case-insensitively', async () => {
    const { suffix } = sha1Parts('case check password');
    const fetchImpl: typeof fetch = async () => rangeResponse([`${suffix.toLowerCase()}:3`]);
    await expect(isPasswordBreached('case check password', { fetchImpl })).resolves.toBe(true);
  });

  it('fails open when the request rejects', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };
    await expect(isPasswordBreached('whatever password', { fetchImpl })).resolves.toBe(false);
  });

  it('fails open on a non-200 response', async () => {
    const fetchImpl: typeof fetch = async () => new Response('slow down', { status: 429 });
    await expect(isPasswordBreached('whatever password', { fetchImpl })).resolves.toBe(false);
  });

  it('fails open on a malformed body', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('<html>gateway error</html>', { status: 200 });
    await expect(isPasswordBreached('whatever password', { fetchImpl })).resolves.toBe(false);
  });

  it('aborts and fails open when the API is slower than the timeout', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(
      isPasswordBreached('whatever password', { fetchImpl, timeoutMs: 20 }),
    ).resolves.toBe(false);
  });
});
