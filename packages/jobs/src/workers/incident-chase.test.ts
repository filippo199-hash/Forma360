/**
 * Unit tests for the incident chase digest (FreeHS module B5).
 *
 * Edge cases:
 *   - IN-J03: quiet when clean; idle investigations, overdue-action
 *     incidents and due effectiveness reviews bucket per owner; one
 *     email per owner.
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
import {
  chaseDetailLines,
  runIncidentChase,
  type IncidentChaseDeps,
  type IncidentChaseDigest,
} from './incident-chase';

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

const logger = createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const NOW = new Date('2026-07-11T09:00:00Z');
const DAY_MS = 86_400_000;

describe('incident-chase', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let leadId: string;
  let closerId: string;
  let sent: Array<{ to: string; digest: IncidentChaseDigest }>;

  function deps(): IncidentChaseDeps {
    return {
      db: db as never,
      logger,
      appUrl: 'https://freehs.test',
      notify: async (recipient, digest) => {
        sent.push({ to: recipient.email, digest });
      },
    };
  }

  async function seedIncident(
    patch: Partial<typeof schema.incidents.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.incidents).values({
      id,
      tenantId,
      referenceNumber: patch.referenceNumber ?? `IN-${id.slice(-6)}`,
      title: 'Chase test',
      kind: 'injury',
      status: 'investigating',
      occurredAt: new Date(NOW.getTime() - 30 * DAY_MS),
      reportedByUserId: leadId,
      leadInvestigatorUserId: leadId,
      ...patch,
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    sent = [];
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    leadId = `usr_${newId()}`;
    closerId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: leadId,
        name: 'Lena Lead',
        email: `lena-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.manager,
      },
      {
        id: closerId,
        name: 'Carl Closer',
        email: `carl-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.manager,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('IN-J03: quiet when clean', async () => {
    // A fresh investigation (updated recently) and a closed incident with
    // no effectiveness due → nothing to chase.
    const id = await seedIncident({ referenceNumber: 'IN-000010' });
    await db.insert(schema.incidentInvestigations).values({
      id: newId(),
      tenantId,
      incidentId: id,
      revision: 1,
      status: 'draft',
      updatedAt: NOW,
    });
    const result = await runIncidentChase(deps(), NOW);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('IN-J03b: idle investigations, overdue actions and due reviews bucket per owner', async () => {
    // Idle investigation owned by Lena.
    const idle = await seedIncident({ referenceNumber: 'IN-000011' });
    await db.insert(schema.incidentInvestigations).values({
      id: newId(),
      tenantId,
      incidentId: idle,
      revision: 1,
      status: 'draft',
      updatedAt: new Date(NOW.getTime() - 20 * DAY_MS),
    });
    // Outstanding incident with an overdue action, owned by Lena.
    const outstanding = await seedIncident({
      referenceNumber: 'IN-000012',
      status: 'actions_outstanding',
    });
    await db.insert(schema.actions).values({
      id: newId(),
      tenantId,
      sourceType: 'incident',
      sourceId: outstanding,
      sourceItemId: newId(),
      title: 'Overdue fix',
      status: 'open',
      dueAt: new Date(NOW.getTime() - 2 * DAY_MS),
      createdBy: leadId,
    });
    // Effectiveness review due, owned by Carl (the closer).
    await seedIncident({
      referenceNumber: 'IN-000013',
      status: 'closed',
      closedByUserId: closerId,
      closedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      effectivenessDueAt: new Date(NOW.getTime() - 1 * DAY_MS),
    });
    // Outstanding incident whose actions are NOT overdue → not chased.
    const fine = await seedIncident({
      referenceNumber: 'IN-000014',
      status: 'actions_outstanding',
    });
    await db.insert(schema.actions).values({
      id: newId(),
      tenantId,
      sourceType: 'incident',
      sourceId: fine,
      sourceItemId: newId(),
      title: 'Future fix',
      status: 'open',
      dueAt: new Date(NOW.getTime() + 5 * DAY_MS),
      createdBy: leadId,
    });

    const result = await runIncidentChase(deps(), NOW);
    expect(result.sent).toBe(2);
    const lena = sent.find((s) => s.to.startsWith('lena-'));
    const carl = sent.find((s) => s.to.startsWith('carl-'));
    expect(lena?.digest.idleInvestigations).toHaveLength(1);
    expect(lena?.digest.overdueActionIncidents).toEqual(['IN-000012 — corrective actions overdue']);
    expect(carl?.digest.effectivenessDue).toEqual(['IN-000013 — effectiveness review due']);
    expect(lena?.digest.idleInvestigations[0]).toContain('IN-000011');
    expect(chaseDetailLines(lena!.digest)).toContain('IN-000011');
  });
});
