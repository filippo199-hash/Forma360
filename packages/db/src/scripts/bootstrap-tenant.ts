/**
 * One-shot bootstrap script — creates the first tenant + its Administrator
 * user so you can log in to a freshly deployed environment.
 *
 * The app does not yet have a signup-creates-tenant flow; until it does,
 * run this script once after the first deploy (or whenever you need a fresh
 * sandbox tenant). It is idempotent: running it again with the same inputs
 * leaves the existing rows alone.
 *
 * Usage (Railway "run command" on the web service, or locally):
 *
 *   FORMA360_BOOTSTRAP_TENANT_NAME="Acme Safety"                \
 *   FORMA360_BOOTSTRAP_TENANT_SLUG="acme"                       \
 *   FORMA360_BOOTSTRAP_ADMIN_EMAIL="you@example.com"            \
 *   FORMA360_BOOTSTRAP_ADMIN_NAME="You"                         \
 *   pnpm --filter @forma360/db db:bootstrap
 *
 * What it does:
 *   1. Creates the tenant if `slug` doesn't exist yet.
 *   2. Seeds the three system permission sets (Administrator / Manager /
 *      Standard) via the canonical `seedDefaultPermissionSets` helper.
 *   3. Creates the user (email-unique) and assigns them the Administrator
 *      permission set. If the user row exists for a DIFFERENT tenant the
 *      script refuses rather than silently re-homing them.
 *
 * Sign-in: after the first deploy, visit `APP_URL`, enter the admin email,
 * and click the magic link that lands in your inbox. better-auth verifies
 * the email against the user row created here and logs you in.
 */
import { newId } from '@forma360/shared/id';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../client';
import { tenants, user } from '../schema';

interface BootstrapInput {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminName: string;
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function readInputFromEnv(): BootstrapInput {
  const tenantSlug = readEnv('FORMA360_BOOTSTRAP_TENANT_SLUG');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantSlug)) {
    throw new Error(
      `FORMA360_BOOTSTRAP_TENANT_SLUG must be lowercase alphanumeric with optional dashes; got "${tenantSlug}"`,
    );
  }
  const adminEmail = readEnv('FORMA360_BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error(`FORMA360_BOOTSTRAP_ADMIN_EMAIL is not a valid email: "${adminEmail}"`);
  }
  return {
    tenantName: readEnv('FORMA360_BOOTSTRAP_TENANT_NAME'),
    tenantSlug,
    adminEmail,
    adminName: readEnv('FORMA360_BOOTSTRAP_ADMIN_NAME'),
  };
}

async function main(): Promise<void> {
  const input = readInputFromEnv();
  const databaseUrl = readEnv('DATABASE_URL');
  const { pool, db } = createDb(databaseUrl);

  try {
    // 1. Upsert tenant by slug.
    const existingTenants = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, input.tenantSlug))
      .limit(1);
    let tenantId: string;
    if (existingTenants[0] !== undefined) {
      tenantId = existingTenants[0].id;
       
      console.log(
        `[bootstrap] tenant slug="${input.tenantSlug}" already exists (id=${tenantId}); reusing`,
      );
    } else {
      tenantId = newId();
      await db.insert(tenants).values({
        id: tenantId,
        name: input.tenantName,
        slug: input.tenantSlug,
      });
       
      console.log(`[bootstrap] tenant created (id=${tenantId}, slug="${input.tenantSlug}")`);
    }

    // 2. Seed default permission sets (idempotent).
    const sets = await seedDefaultPermissionSets(db, tenantId);
     
    console.log(
      `[bootstrap] permission sets ready (administrator=${sets.administrator}, manager=${sets.manager}, standard=${sets.standard})`,
    );

    // 3. Upsert admin user by email.
    const existingUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, input.adminEmail))
      .limit(1);
    if (existingUsers[0] !== undefined) {
      const existing = existingUsers[0];
      if (existing.tenantId !== tenantId) {
        throw new Error(
          `User with email "${input.adminEmail}" already exists in tenant ${existing.tenantId}; refusing to re-home. Drop or reassign that row manually first.`,
        );
      }
      if (existing.permissionSetId !== sets.administrator) {
        await db
          .update(user)
          .set({ permissionSetId: sets.administrator, updatedAt: new Date() })
          .where(and(eq(user.id, existing.id), eq(user.tenantId, tenantId)));
         
        console.log(
          `[bootstrap] user "${input.adminEmail}" existed; upgraded to Administrator`,
        );
      } else {
         
        console.log(
          `[bootstrap] user "${input.adminEmail}" already exists and is Administrator; no change`,
        );
      }
    } else {
      const userId = `usr_${newId()}`;
      await db.insert(user).values({
        id: userId,
        name: input.adminName,
        email: input.adminEmail,
        emailVerified: false,
        tenantId,
        permissionSetId: sets.administrator,
      });
       
      console.log(
        `[bootstrap] admin user created (id=${userId}, email="${input.adminEmail}")`,
      );
    }

     
    console.log('[bootstrap] done. Sign in at APP_URL with the admin email.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
   
  console.error('[bootstrap] FAILED:', err);
  process.exit(1);
});
