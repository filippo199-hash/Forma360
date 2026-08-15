/**
 * Object-store (R2) wiring check.
 *
 * Same reasoning as the Sentry check next door: an endpoint that only
 * reads env vars would prove nothing, because the failure mode is never a
 * missing string — it is a credential the store rejects. So this performs
 * the real round-trip the exporters perform (pre-signed PUT → GET →
 * DELETE) against a throwaway key and reports exactly which step failed
 * and what R2 said about it.
 *
 * It exists because a production 403 sat unexplained: the upload path
 * logged `R2 upload failed: 403 Forbidden` and discarded the XML body, so
 * five very different causes — wrong key id, wrong secret, read-only
 * token, token scoped to another bucket, wrong account in the endpoint —
 * were indistinguishable. Each line of `diagnosis` below maps one R2
 * error code to the fix it actually implies.
 *
 * Never returns the secret. Config is reported as shape only: which vars
 * are set, the bucket and account the client is aimed at (both are
 * identifiers, not credentials), and key lengths — enough to spot a
 * truncated paste or a trailing newline without disclosing the value.
 *
 * Auth: session + `org.settings` (administrator), matching sentry-check.
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { createStorage } from '@forma360/shared/storage';
import { headers } from 'next/headers';
import { createContext } from '../../../../src/server/trpc';

/** What each R2 error code means for whoever has to fix it. */
const DIAGNOSIS: Record<string, string> = {
  InvalidAccessKeyId:
    'R2_ACCESS_KEY_ID is not a key this account recognises — the token was deleted or belongs to another Cloudflare account.',
  SignatureDoesNotMatch:
    'The signature R2 computed differs from ours. Check the SIGNING METHOD before the secret: this code is also what R2 returns when a pre-signed URL carries parameters the caller cannot reproduce, which is what an SDK bump did to every upload in the product (see requestChecksumCalculation in @forma360/shared/storage). If the pre-signed URL is clean, then R2_SECRET_ACCESS_KEY is truncated or mis-pasted.',
  AccessDenied:
    'The credential is valid but not allowed to write this bucket — the R2 token is read-only, or scoped to different buckets than R2_BUCKET.',
  NoSuchBucket: 'R2_BUCKET does not exist in the account named by R2_ACCOUNT_ID.',
  RequestTimeTooSkewed: "The container clock has drifted from R2's.",
};

function describe(value: string | undefined): { set: boolean; length: number } {
  return { set: (value ?? '').length > 0, length: (value ?? '').length };
}

/** Pull the S3 error code out of R2's XML body. */
function errorCode(body: string): string | null {
  return /<Code>([^<]*)<\/Code>/.exec(body)?.[1]?.trim() || null;
}

export async function POST(): Promise<Response> {
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!grantsAdminAccess(perms)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const accountId = process.env['R2_ACCOUNT_ID'] ?? '';
  const bucket = process.env['R2_BUCKET'] ?? '';
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'] ?? '';
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'] ?? '';

  const config = {
    bucket,
    accountId,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: describe(accessKeyId),
    secretAccessKey: describe(secretAccessKey),
    publicUrlConfigured: (process.env['R2_PUBLIC_URL'] ?? '').length > 0,
    // A pasted value that kept its newline signs every request wrongly
    // while looking correct in any dashboard that trims for display.
    accessKeyIdHasWhitespace: accessKeyId !== accessKeyId.trim(),
    secretAccessKeyHasWhitespace: secretAccessKey !== secretAccessKey.trim(),
  };

  if (accountId === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
    return Response.json({
      ok: false,
      failedStep: 'config',
      diagnosis: 'One or more R2 environment variables are empty.',
      config,
      requestId: ctx.requestId,
    });
  }

  const storage = createStorage({ accountId, accessKeyId, secretAccessKey, bucket });
  // Same key convention as real objects, so a bucket-scoped or
  // prefix-scoped token is exercised the way the exporters exercise it.
  const key = `${ctx.auth.tenantId}/diagnostics/${ctx.auth.tenantId}/r2-check-${ctx.requestId}.txt`;
  const payload = `r2-check ${ctx.requestId}`;

  async function step(
    name: 'put' | 'get' | 'delete',
    run: () => Promise<Response>,
  ): Promise<{ ok: true } | { ok: false; body: Response }> {
    let res: Response;
    try {
      res = await run();
    } catch (err) {
      return {
        ok: false,
        body: Response.json({
          ok: false,
          failedStep: name,
          diagnosis: `Could not reach the object store: ${err instanceof Error ? err.message : String(err)}`,
          config,
          requestId: ctx.requestId,
        }),
      };
    }
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => '')).slice(0, 2000);
    const code = errorCode(text);
    return {
      ok: false,
      body: Response.json({
        ok: false,
        failedStep: name,
        status: res.status,
        code,
        message: /<Message>([^<]*)<\/Message>/.exec(text)?.[1]?.trim() ?? null,
        diagnosis:
          code !== null && code in DIAGNOSIS
            ? DIAGNOSIS[code]
            : `R2 rejected the ${name} with ${res.status} and no recognised error code.`,
        config,
        requestId: ctx.requestId,
      }),
    };
  }

  const put = await step('put', async () =>
    fetch(await storage.getSignedUploadUrl({ key, contentType: 'text/plain' }), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    }),
  );
  if (!put.ok) return put.body;

  // Read it back: a write that succeeds but reads back empty means the
  // bucket is fine and something downstream (lifecycle rule, CDN) is not.
  const get = await step('get', async () => fetch(await storage.getSignedDownloadUrl({ key })));
  if (!get.ok) return get.body;

  let deleteError: string | null = null;
  try {
    await storage.deleteObject({ key });
  } catch (err) {
    // The probe object is tiny and namespaced; a failed cleanup is worth
    // reporting but does not make the check a failure.
    deleteError = err instanceof Error ? err.message : String(err);
  }

  return Response.json({
    ok: true,
    diagnosis: 'Upload, download and delete all succeeded — object storage is healthy.',
    deleteError,
    config,
    requestId: ctx.requestId,
  });
}
