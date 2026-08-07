/**
 * Sandbox provisioning — the workspace a visitor gets before signing up.
 *
 * Edge-case IDs:
 *   SB-E20 — provisioning creates a tenant, an admin user and the
 *            shared org context (sites, contractors, categories).
 *   SB-E21 — the tenant carries the sandbox marker and starts unclaimed.
 *   SB-E22 — the placeholder email is on the reserved .invalid domain.
 *   SB-E23 — a tile the brand does not ship is refused, and nothing is
 *            written.
 *   SB-E24 — the risk-assessment seed leaves the last hazard unrated
 *            and uncontrolled (the visitor's decision).
 *   SB-E25 — the permit seed produces a permit of the chosen category.
 *   SB-E26 — the observation seed fills the register.
 *   SB-E27 — two sandboxes never collide on email or slug.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { isSandboxEmail, provisionSandbox, SandboxChoiceError } from './provision';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const silentLogger = () =>
  createLogger({ service: 'sandbox-test', level: 'fatal', nodeEnv: 'test' });

describe('provisionSandbox', () => {
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ db } = await bootDb());
  });

  function provision(scenarioId: string, refinementId: string) {
    return provisionSandbox(db as never, silentLogger(), {
      brand: 'freehs',
      choice: { scenarioId: scenarioId as never, refinementId },
    });
  }

  it('SB-E20 — creates a tenant, an admin user and the shared org context', async () => {
    const { tenantId, userId, landingPath } = await provision('riskAssessment', 'general');

    expect(landingPath).toBe('/risk-assessments');

    const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    expect(tenant).toHaveLength(1);

    const users = await db.select().from(schema.user).where(eq(schema.user.tenantId, tenantId));
    // The visitor plus one colleague to assign work to.
    expect(users).toHaveLength(2);
    expect(users.some((u) => u.id === userId)).toBe(true);

    const siteRows = await db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.tenantId, tenantId));
    expect(siteRows.length).toBeGreaterThanOrEqual(2);

    const contractorRows = await db
      .select()
      .from(schema.contractors)
      .where(eq(schema.contractors.tenantId, tenantId));
    expect(contractorRows.length).toBeGreaterThanOrEqual(2);

    const categories = await db
      .select()
      .from(schema.issueCategories)
      .where(eq(schema.issueCategories.tenantId, tenantId));
    expect(categories.length).toBeGreaterThanOrEqual(4);

    const sets = await db
      .select()
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.tenantId, tenantId));
    expect(sets.length).toBeGreaterThanOrEqual(3);
  });

  it('SB-E21 — the tenant carries the sandbox marker and starts unclaimed', async () => {
    const { tenantId } = await provision('permit', 'hotWork');
    const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));

    expect(rows[0]?.settings.sandbox).toEqual({
      scenarioId: 'permit',
      refinementId: 'hotWork',
    });
    expect(rows[0]?.settings.sandbox?.claimedAt).toBeUndefined();
  });

  it('SB-E22 — the placeholder email is on the reserved .invalid domain', async () => {
    const { tenantId, userId } = await provision('hazard', 'withActions');
    const rows = await db.select().from(schema.user).where(eq(schema.user.id, userId));

    expect(rows[0]?.email).toContain('@sandbox.invalid');
    expect(isSandboxEmail(rows[0]?.email ?? '')).toBe(true);
    expect(rows[0]?.tenantId).toBe(tenantId);
    expect(rows[0]?.emailVerified).toBe(false);
  });

  it('SB-E23 — a tile the brand does not ship is refused and writes nothing', async () => {
    await expect(
      provisionSandbox(db as never, silentLogger(), {
        brand: 'forma360',
        choice: { scenarioId: 'permit', refinementId: 'hotWork' },
      }),
    ).rejects.toBeInstanceOf(SandboxChoiceError);

    const tenantRows = await db.select().from(schema.tenants);
    expect(tenantRows).toHaveLength(0);
  });

  it('SB-E24 — the risk-assessment seed leaves the last hazard for the visitor', async () => {
    const { tenantId } = await provision('riskAssessment', 'general');

    const assessments = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.tenantId, tenantId));
    expect(assessments).toHaveLength(1);
    expect(assessments[0]?.status).toBe('draft');

    const hazards = await db
      .select()
      .from(schema.riskAssessmentHazards)
      .where(eq(schema.riskAssessmentHazards.tenantId, tenantId));
    expect(hazards.length).toBeGreaterThanOrEqual(3);

    const bySort = [...hazards].sort((a, b) => a.sortOrder - b.sortOrder);
    const last = bySort[bySort.length - 1];
    expect(last?.residualLikelihood).toBeNull();
    expect(last?.residualSeverity).toBeNull();

    const controls = await db
      .select()
      .from(schema.riskAssessmentControls)
      .where(eq(schema.riskAssessmentControls.hazardId, last?.id ?? ''));
    expect(controls).toHaveLength(0);

    // ...while the earlier hazards are fully worked, so the document
    // reads as someone else's work-in-progress rather than a blank form.
    const firstControls = await db
      .select()
      .from(schema.riskAssessmentControls)
      .where(eq(schema.riskAssessmentControls.hazardId, bySort[0]?.id ?? ''));
    expect(firstControls.length).toBeGreaterThan(0);
  });

  it('SB-E25 — the permit seed produces a permit of the chosen category', async () => {
    const { tenantId } = await provision('permit', 'confinedSpace');

    const types = await db
      .select()
      .from(schema.permitTypes)
      .where(eq(schema.permitTypes.tenantId, tenantId));
    expect(types.length).toBeGreaterThanOrEqual(9);

    const permitRows = await db
      .select()
      .from(schema.permits)
      .where(eq(schema.permits.tenantId, tenantId));
    expect(permitRows).toHaveLength(1);

    const type = types.find((t) => t.id === permitRows[0]?.permitTypeId);
    expect(type?.category).toBe('confined_space');
  });

  it('SB-E26 — the observation seed fills the register', async () => {
    const { tenantId } = await provision('hazard', 'withActions');

    const rows = await db.select().from(schema.issues).where(eq(schema.issues.tenantId, tenantId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((r) => r.referenceNumber)).size).toBe(rows.length);
  });

  it('SB-E27 — two sandboxes never collide on email or slug', async () => {
    const a = await provision('riskAssessment', 'general');
    const b = await provision('riskAssessment', 'general');

    expect(a.tenantId).not.toBe(b.tenantId);

    const tenantRows = await db.select().from(schema.tenants);
    expect(new Set(tenantRows.map((t) => t.slug)).size).toBe(tenantRows.length);

    const userRows = await db.select().from(schema.user);
    expect(new Set(userRows.map((u) => u.email)).size).toBe(userRows.length);
  });
});
