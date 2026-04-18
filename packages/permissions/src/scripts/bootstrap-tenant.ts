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
 *   FORMA360_BOOTSTRAP_ADMIN_PASSWORD="a-12+-char-password"     \
 *   pnpm --filter @forma360/permissions db:bootstrap
 *
 * What it does:
 *   1. Creates the tenant if `slug` doesn't exist yet.
 *   2. Seeds the three system permission sets (Administrator / Manager /
 *      Standard) via the canonical `seedDefaultPermissionSets` helper.
 *   3. Creates / upserts the user (email-unique) with emailVerified=true
 *      and the Administrator permission set. If the user row exists for a
 *      DIFFERENT tenant the script refuses rather than silently re-homing.
 *   4. Creates / upserts the matching credential account row with the
 *      hashed password so email+password sign-in works immediately.
 *
 * Sign-in: after running this, visit APP_URL and sign in with the email +
 * password you just set. No verification email needed — the bootstrap
 * user is created pre-verified.
 */
import { createDb } from '@forma360/db/client';
import { account, tenants, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { seedDefaultPermissionSets } from '../seed';

interface BootstrapInput {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
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
  const adminPassword = readEnv('FORMA360_BOOTSTRAP_ADMIN_PASSWORD');
  // Better-auth's emailAndPassword config in packages/auth requires 12+ chars.
  if (adminPassword.length < 12) {
    throw new Error(
      `FORMA360_BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters (got ${adminPassword.length})`,
    );
  }
  return {
    tenantName: readEnv('FORMA360_BOOTSTRAP_TENANT_NAME'),
    tenantSlug,
    adminEmail,
    adminName: readEnv('FORMA360_BOOTSTRAP_ADMIN_NAME'),
    adminPassword,
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

    // 3. Upsert admin user by email. Also create / replace the matching
    // credential account row so better-auth's email+password sign-in path
    // works immediately (no verification round-trip needed for the
    // bootstrap admin). emailVerified is forced true for the same reason.
    const passwordHash = await hashPassword(input.adminPassword);
    const existingUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, input.adminEmail))
      .limit(1);
    let userId: string;
    if (existingUsers[0] !== undefined) {
      const existing = existingUsers[0];
      if (existing.tenantId !== tenantId) {
        throw new Error(
          `User with email "${input.adminEmail}" already exists in tenant ${existing.tenantId}; refusing to re-home. Drop or reassign that row manually first.`,
        );
      }
      userId = existing.id;
      const updates: Partial<typeof user.$inferInsert> = { updatedAt: new Date() };
      if (existing.permissionSetId !== sets.administrator) {
        updates.permissionSetId = sets.administrator;
      }
      if (!existing.emailVerified) updates.emailVerified = true;
      if (Object.keys(updates).length > 1) {
        await db
          .update(user)
          .set(updates)
          .where(and(eq(user.id, existing.id), eq(user.tenantId, tenantId)));
        console.log(`[bootstrap] user "${input.adminEmail}" updated`);
      } else {
        console.log(`[bootstrap] user "${input.adminEmail}" already correct`);
      }
    } else {
      userId = `usr_${newId()}`;
      await db.insert(user).values({
        id: userId,
        name: input.adminName,
        email: input.adminEmail,
        emailVerified: true,
        tenantId,
        permissionSetId: sets.administrator,
      });
      console.log(
        `[bootstrap] admin user created (id=${userId}, email="${input.adminEmail}")`,
      );
    }

    // 4. Upsert the credential account row with the hashed password.
    // better-auth stores each auth mechanism in its own `account` row keyed
    // by (userId, providerId). For email+password `providerId === 'credential'`
    // and `accountId` is the email.
    const existingAccount = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .limit(1);
    if (existingAccount[0] !== undefined) {
      await db
        .update(account)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(eq(account.id, existingAccount[0].id));
      console.log(`[bootstrap] credential account password updated`);
    } else {
      await db.insert(account).values({
        id: `acc_${newId()}`,
        userId,
        accountId: input.adminEmail,
        providerId: 'credential',
        password: passwordHash,
      });
      console.log(`[bootstrap] credential account created`);
    }

    console.log(
      `[bootstrap] done. Sign in at APP_URL with email="${input.adminEmail}" and the password you just set.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
   
  console.error('[bootstrap] FAILED:', err);
  process.exit(1);
});
