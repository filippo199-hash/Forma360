/**
 * Every upload route handler authorises, not just authenticates.
 *
 * DC-S02: `POST /api/documents/upload` had no permission check at all — a
 * bare session was enough. Any authenticated user of any tenant, including a
 * Standard field worker and including a try-it-now sandbox visitor (ADR 0017
 * mints a real better-auth session on a public marketing funnel), could curl
 * it in a loop and write unbounded 50 MB objects into the production R2
 * bucket. No row is created, so nothing in the product shows the bytes exist
 * and nothing ever deletes them.
 *
 * Ten of the fourteen handlers already gated; the sibling documents DOWNLOAD
 * route always has. Reading found the gap after it shipped, which is why this
 * is a test rather than a comment: it walks the routes.
 *
 * Edge cases:
 *   - UP-E01: every write route that stores bytes loads permissions
 *   - UP-E02: …and refuses with 403 when the caller lacks the key
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'api');

/**
 * Routes that legitimately authorise by something other than a permission
 * key. Each needs a reason, so adding one is a decision rather than a
 * shortcut.
 */
const NON_PERMISSION_ROUTES = new Map<string, string>([
  // The opaque token IS the capability — the uploader has no account.
  ['contractor-upload/route.ts', 'public token-gated contractor portal'],
  ['scan-upload/[token]/route.ts', 'public token-gated QR hazard report, rate-limited'],
  // Authorises through a tRPC caller instead, which runs requirePermission
  // for it: `caller.inspections.get` enforces `inspections.view` and tenant
  // scoping before a byte is written. A different pattern, not a missing one.
  ['upload/route.ts', 'authorises via appRouter.createCaller(ctx).inspections.get'],
  // better-auth's own handler.
  ['auth/[...all]/route.ts', 'better-auth'],
  ['trpc/[trpc]/route.ts', 'tRPC does its own per-procedure checks'],
  ['ai/route.ts', 'delegates to tRPC callers that check per procedure'],
]);

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else if (entry.name === 'route.ts') out.push(rel);
  }
  return out;
}

describe('upload route authorisation', () => {
  it('UP-E01/UP-E02: every route that writes bytes loads permissions and can refuse', async () => {
    const routes = await walk(API_DIR);
    expect(routes.length).toBeGreaterThan(10);

    const ungated: string[] = [];
    for (const rel of routes) {
      if ([...NON_PERMISSION_ROUTES.keys()].some((k) => rel.endsWith(k))) continue;
      const source = await readFile(join(API_DIR, rel), 'utf-8');
      // Only handlers that actually persist bytes are in scope.
      const writesBytes =
        source.includes('getSignedUploadUrl') ||
        source.includes('putObject') ||
        source.includes('writeFile(');
      if (!writesBytes) continue;
      const gated = source.includes('loadUserPermissions') && source.includes('{ status: 403 }');
      if (!gated) ungated.push(rel);
    }
    expect(ungated).toEqual([]);
  });
});
