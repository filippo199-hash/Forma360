/**
 * "My work" queue tests (ADR 0014).
 *
 * Edge cases:
 *   - MW-E01: counts are strictly the caller's own — another user's
 *     assigned action, acknowledgement and draft never leak in
 *   - MW-E02: the approvals queue is folded in only for callers holding
 *     `inspections.manage`; it is excluded from the personal `total`
 *   - MW-E03: `list` merges every kind and sorts overdue-first, then by
 *     due date, then undated
 *   - MW-E04: the `kinds` filter narrows the feed
 *   - MW-E05: the router needs no module permission — a user holding
 *     nothing still sees their own work
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);
const DAY = 86_400_000;

describe('myWork (ADR 0014)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let workerId: string;
  let templateId: string;
  let versionId: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'w@x.test', tenantId: tenantId as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    workerId = `usr_${newId()}`;
    // A permission set holding nothing at all — MW-E05.
    const emptySetId = newId();
    await db.insert(schema.permissionSets).values({
      id: emptySetId,
      tenantId,
      name: 'Field only',
      permissions: [],
    });
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: workerId,
        name: 'Wes Worker',
        email: `wes-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: emptySetId,
      },
    ]);
    templateId = newId();
    versionId = newId();
    await db
      .insert(schema.templates)
      .values({ id: templateId, tenantId, name: 'Walk', createdBy: adminId });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: { schemaVersion: '1', title: 'Walk', pages: [], settings: {} } as any,
      publishedAt: new Date(),
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedAction(over: Partial<typeof schema.actions.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(schema.actions).values({
      id,
      tenantId,
      sourceType: 'standalone',
      title: 'Task',
      status: 'open',
      createdBy: adminId,
      ...over,
    });
    return id;
  }

  async function seedInspection(
    over: Partial<typeof schema.inspections.$inferInsert>,
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.inspections).values({
      id,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'Audit',
      accessSnapshot: {
        groups: [],
        sites: [],
        permissions: ['inspections.view'],
        snapshotAt: new Date().toISOString(),
      },
      createdBy: adminId,
      ...over,
    });
    return id;
  }

  async function seedAck(userId: string, over: Partial<typeof schema.headsUps.$inferInsert> = {}) {
    const headsUpId = newId();
    await db.insert(schema.headsUps).values({
      id: headsUpId,
      tenantId,
      title: 'Toolbox talk',
      status: 'published',
      requireAcknowledgement: true,
      createdByUserId: adminId,
      ...over,
    });
    await db.insert(schema.headsUpRecipients).values({ id: newId(), tenantId, headsUpId, userId });
    return headsUpId;
  }

  it('MW-E01 / MW-E05: counts are the caller own, with no permission needed', async () => {
    await seedAction({ assigneeUserId: workerId, dueAt: new Date(Date.now() - DAY) });
    await seedAction({ assigneeUserId: workerId, dueAt: new Date(Date.now() + 5 * DAY) });
    // Somebody else's work must never appear in Wes's counts.
    await seedAction({ assigneeUserId: adminId });
    await seedAck(workerId);
    await seedAck(adminId);
    await seedInspection({ status: 'in_progress', conductedBy: workerId });
    await seedInspection({ status: 'in_progress', conductedBy: adminId });

    const wes = await callerFor(workerId).myWork.counts();
    expect(wes.myOpenActions).toBe(2);
    expect(wes.myOverdueActions).toBe(1);
    expect(wes.myPendingAcks).toBe(1);
    expect(wes.myDraftInspections).toBe(1);
    expect(wes.total).toBe(4);
    // Wes holds no permissions at all and is still served.
    expect(wes.awaitingApproval).toBe(0);
  });

  it('MW-E02: the approvals queue needs inspections.manage and stays out of `total`', async () => {
    await seedInspection({ status: 'awaiting_approval' });
    await seedInspection({ status: 'awaiting_signature_workflow' });

    const wes = await callerFor(workerId).myWork.counts();
    expect(wes.awaitingApproval).toBe(0);

    const alice = await callerFor(adminId).myWork.counts();
    expect(alice.awaitingApproval).toBe(2);
    // Not personal work — the "My work" badge must not include it.
    expect(alice.total).toBe(0);
  });

  it('MW-E03: the feed merges kinds and sorts overdue-first then by due date', async () => {
    await seedAction({
      assigneeUserId: workerId,
      title: 'Later',
      dueAt: new Date(Date.now() + 10 * DAY),
    });
    await seedAction({
      assigneeUserId: workerId,
      title: 'Late',
      dueAt: new Date(Date.now() - 2 * DAY),
    });
    await seedAction({
      assigneeUserId: workerId,
      title: 'Soon',
      dueAt: new Date(Date.now() + DAY),
    });
    await seedAction({ assigneeUserId: workerId, title: 'Undated' });
    await seedInspection({ status: 'in_progress', conductedBy: workerId, title: 'Half-done walk' });

    const { rows } = await callerFor(workerId).myWork.list({ limit: 50 });
    expect(rows[0]?.title).toContain('Late');
    expect(rows[0]?.overdue).toBe(true);
    expect(rows[1]?.title).toContain('Soon');
    expect(rows[2]?.title).toContain('Later');
    // Undated rows (including the draft inspection) fall to the back.
    expect(rows.slice(3).every((r) => r.dueAt === null)).toBe(true);
    expect(rows.map((r) => r.kind)).toContain('inspection');
    expect(rows.find((r) => r.kind === 'inspection')?.href).toMatch(/^\/inspections\//);
  });

  it('MW-E04: the kinds filter narrows the feed', async () => {
    await seedAction({ assigneeUserId: workerId });
    await seedAck(workerId);

    const onlyAcks = await callerFor(workerId).myWork.list({
      limit: 50,
      kinds: ['acknowledgement'],
    });
    expect(onlyAcks.rows).toHaveLength(1);
    expect(onlyAcks.rows[0]?.kind).toBe('acknowledgement');
    expect(onlyAcks.rows[0]?.href).toMatch(/^\/heads-up\/.*\/view$/);

    const everything = await callerFor(workerId).myWork.list({ limit: 50 });
    expect(everything.rows).toHaveLength(2);
  });
});
