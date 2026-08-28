/**
 * aiAgents router — per-tenant agent customization. Edge-case IDs AG-E01..E08.
 *
 * pglite + the full migration chain, the admin.test.ts harness shape.
 * What matters here: the admin-only write gate, upserts that never
 * clobber unspecified fields, settings validated against the catalogue's
 * option vocabularies, and — above all — that one tenant's knowledge is
 * unreachable from another (AG-E06/E07): the whole isolation story for
 * agents is that customization rows are ordinary ADR 0002 scoped rows.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import { AI_AGENTS, AI_KNOWLEDGE_LIMITS } from '@forma360/shared/ai-agents';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of await migrationFiles()) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('aiAgents router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let standardUserId: string;

  function ctxFor(userId: string, tenant = tenantId): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: 'someone@acme.test', tenantId: tenant as never },
    });
  }

  async function bootTenant(slug: string): Promise<{ tenant: string; admin: string }> {
    const tenant = newId();
    await db.insert(schema.tenants).values({ id: tenant, name: slug, slug });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenant);
    const admin = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: admin,
      name: 'Admin',
      email: `${slug}-admin@acme.test`,
      tenantId: tenant,
      permissionSetId: seeded.administrator,
    });
    return { tenant, admin };
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = `usr_${newId()}`;
    standardUserId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Alice',
        email: 'alice@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: standardUserId,
        name: 'Stan',
        email: 'stan@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('AG-E01: list returns every catalogue agent with defaults when nothing is stored', async () => {
    const caller = createCaller(ctxFor(standardUserId));
    const list = await caller.aiAgents.list();
    expect(list.map((a) => a.id)).toEqual(AI_AGENTS.map((d) => d.id));
    for (const row of list) {
      expect(row.enabled).toBe(true);
      expect(row.hasKnowledge).toBe(false);
    }
  });

  it('AG-E02: editing is org.settings only — a standard user is refused, reads stay open', async () => {
    const standard = createCaller(ctxFor(standardUserId));
    await expect(
      standard.aiAgents.updateSettings({ agentId: 'ra-drafter', knowledge: 'x' }),
    ).rejects.toThrow(/Missing permission: org.settings/);
    // Reading stays open: an employee may see what the agent was taught.
    const detail = await standard.aiAgents.get({ agentId: 'ra-drafter' });
    expect(detail.knowledge).toBe('');
  });

  it('AG-E03: partial updates never clobber the other fields', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await admin.aiAgents.updateSettings({
      agentId: 'ra-drafter',
      knowledge: 'We are a scaffolding contractor. Always reference TG20:21.',
    });
    await admin.aiAgents.updateSettings({ agentId: 'ra-drafter', enabled: false });
    const detail = await admin.aiAgents.get({ agentId: 'ra-drafter' });
    expect(detail.enabled).toBe(false);
    expect(detail.knowledge).toContain('TG20:21');
  });

  it('AG-E04: settings must match the catalogue vocabulary', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await expect(
      admin.aiAgents.updateSettings({ agentId: 'ra-drafter', settings: { bogus: 'x' } }),
    ).rejects.toThrow('invalid-settings');
    await expect(
      admin.aiAgents.updateSettings({ agentId: 'ra-drafter', settings: { detail: 'extreme' } }),
    ).rejects.toThrow('invalid-settings');
    await admin.aiAgents.updateSettings({
      agentId: 'ra-drafter',
      settings: { detail: 'thorough' },
    });
    const detail = await admin.aiAgents.get({ agentId: 'ra-drafter' });
    expect(detail.settings['detail']).toBe('thorough');
  });

  it('AG-E05: the knowledge text cap is enforced at the boundary', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await expect(
      admin.aiAgents.updateSettings({
        agentId: 'ra-drafter',
        knowledge: 'x'.repeat(AI_KNOWLEDGE_LIMITS.textChars + 1),
      }),
    ).rejects.toThrow();
  });

  it("AG-E06: one tenant never sees another tenant's customization", async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await admin.aiAgents.updateSettings({
      agentId: 'ra-drafter',
      knowledge: 'Acme-only trade secrets',
      enabled: false,
    });
    const other = await bootTenant('other');
    const otherCaller = createCaller(ctxFor(other.admin, other.tenant));
    const detail = await otherCaller.aiAgents.get({ agentId: 'ra-drafter' });
    expect(detail.knowledge).toBe('');
    expect(detail.enabled).toBe(true);
    const list = await otherCaller.aiAgents.list();
    expect(list.find((a) => a.id === 'ra-drafter')?.hasKnowledge).toBe(false);
  });

  it('AG-E07: knowledge-file delete is tenant-scoped and best-effort on the blob', async () => {
    const fileId = newId();
    await db.insert(schema.aiAgentKnowledgeFiles).values({
      id: fileId,
      tenantId,
      agentId: 'ra-drafter',
      filename: 'standards.pdf',
      storageKey: `${tenantId}/ai-knowledge/${fileId}/standards.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      extractedText: 'TG20:21 says…',
      status: 'ready',
    });
    // Another tenant cannot delete it — NOT_FOUND, not FORBIDDEN, so the
    // response does not even confirm the file exists.
    const other = await bootTenant('other2');
    const otherCaller = createCaller(ctxFor(other.admin, other.tenant));
    await expect(otherCaller.aiAgents.deleteKnowledgeFile({ fileId })).rejects.toThrow(
      'file-not-found',
    );
    // The owner can.
    const admin = createCaller(ctxFor(adminUserId));
    await admin.aiAgents.deleteKnowledgeFile({ fileId });
    const detail = await admin.aiAgents.get({ agentId: 'ra-drafter' });
    expect(detail.files).toHaveLength(0);
  });

  it('AG-E08: unknown agent ids are refused everywhere', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await expect(admin.aiAgents.get({ agentId: 'nonsense' })).rejects.toThrow();
    await expect(
      admin.aiAgents.updateSettings({ agentId: 'nonsense', knowledge: 'x' }),
    ).rejects.toThrow();
  });
});
