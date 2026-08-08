/**
 * Assets module — the audit suite (FreeHS).
 *
 * The fifth module through the testing runbook, and chosen for two reasons.
 *
 * **It has churned.** Four commits landed on `main` in the last few days —
 * the overview rebuilt from six tabs to four, custom fields made visible and
 * editable after creation, a field-suggestion feature added, and the whole
 * maintenance feature removed. Recently-moved code is where defects live, and
 * a module that has just had a feature *deleted* is where dead surfaces are
 * left behind.
 *
 * **It is a hub.** The asset detail page reads linked records from three
 * other modules — observations, actions, inspections — and assets are
 * referenced back by contractors and fire safety. The Heads-Up audit
 * established the shape of the interesting defect in a platform like this:
 * a module's own access rule holding perfectly, and being bypassed by
 * whichever module reads across the boundary. Assets is the biggest reader
 * of other modules in the product.
 *
 * Five axes:
 *
 *   1. **AS-P — the generated permission matrix.** Every `assets.*` and
 *      `assetTypes.*` procedure enumerated from the router at runtime.
 *   2. **AS-X — cross-module reads.** The three linked-record endpoints,
 *      asked as somebody who holds `assets.view` and nothing else.
 *   3. **AS-H — hierarchy.** The depth-1 cap, which is what stands in for a
 *      cycle guard given `parent_id` carries no foreign key at all.
 *   4. **AS-T — tenancy.** Ground rule 4, against the mirror tenant.
 *   5. **AS-V — volume.** 520 assets against a list that caps at 500 and
 *      offers no cursor.
 *
 * Every test describes CORRECT behaviour. Those that name a live defect fail
 * today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function assetProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('assets.') || k.startsWith('assetTypes.'))
    .sort();
}

function resolve(caller: Caller, path: string): (input?: unknown) => Promise<unknown> {
  return path
    .split('.')
    .reduce<
      Record<string, unknown>
    >((acc, part) => acc[part] as Record<string, unknown>, caller as unknown as Record<string, unknown>) as unknown as (
    input?: unknown,
  ) => Promise<unknown>;
}

async function callFor(
  caller: Caller,
  path: string,
  input?: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, value: await resolve(caller, path)(input) };
  } catch (err) {
    return {
      ok: false,
      code: err instanceof TRPCError ? err.code : 'NON_TRPC_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe('assets — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** Holds `assets.view` and `assets.readings.record`, and nothing else. */
  let assetOnlyUserId: string;

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    // The actor the cross-module axis needs: somebody who can look up a fork
    // lift and holds no key for observations, actions or inspections. A real
    // customer builds exactly this set for a plant supervisor.
    const setId = newId();
    await world.db.insert(schema.permissionSets).values({
      id: setId,
      tenantId: world.a.tenantId,
      name: 'Plant supervisor',
      permissions: ['assets.view', 'assets.readings.record'],
    });
    assetOnlyUserId = newId();
    await world.db.insert(schema.user).values({
      id: assetOnlyUserId,
      tenantId: world.a.tenantId,
      name: 'Pat Plant',
      email: 'plant@northgate.test',
      permissionSetId: setId,
    });
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asAssetOnly = () => createCaller(world.ctxFor(world.a.tenantId, assetOnlyUserId));

  // ═══════════════════════════════════════════════════════════════════════
  // AS-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('AS-P · permissions', () => {
    it('AS-P00 · the matrix covers every assets procedure the router exposes', () => {
      const procs = assetProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(16);
      expect(procs).toContain('assets.readings.add');
      expect(procs).toContain('assetTypes.create');
    });

    it('AS-P01 · every procedure refuses a user holding no assets key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of assetProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('AS-P02 · recording a reading is a distinct key from managing the register', async () => {
      // `assets.readings.record` exists so an operator can log engine hours
      // without being able to rename, re-parent or archive plant. If it does
      // not actually separate, the catalogue is promising a role the server
      // does not implement — the defect found in Contractors as CT-P03.
      const caller = asAssetOnly();
      const reading = await callFor(caller, 'assets.readings.add', {
        assetId: world.a.assets.root as string,
        fieldName: 'Engine hours',
        value: 1400,
        unit: 'h',
      });
      expect({ step: 'reading', ok: reading.ok }).toEqual({ step: 'reading', ok: true });

      for (const [path, input] of [
        ['assets.update', { assetId: world.a.assets.root as string, name: 'Renamed by operator' }],
        ['assets.archive', { assetId: world.a.assets.root as string }],
        ['assets.create', { name: 'Should not exist' }],
        ['assetTypes.create', { name: 'Should not exist' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AS-X — cross-module reads
  // ═══════════════════════════════════════════════════════════════════════
  describe('AS-X · cross-module reads', () => {
    it('AS-X00 · the observations module refuses this caller directly', async () => {
      // The control. Everything below is only meaningful because the linked
      // observation is genuinely out of reach through its own module.
      const res = await callFor(asAssetOnly(), 'issues.get', { id: world.a.linkedIssueId });
      expect({ readableViaIssues: res.ok }).toEqual({ readableViaIssues: false });
    });

    it('AS-X01 · the asset page does not disclose observations to a caller without issues.view', async () => {
      // `listLinkedObservations` joins `issue_assets → issues` on nothing but
      // `assets.view`, returning title, status, priority and reference
      // number. A plant supervisor who cannot open the observations register
      // reads the titles of every observation raised against their plant —
      // and an observation title is routinely the sensitive part
      // ("Brake failure — operator named in report").
      const res = await callFor(asAssetOnly(), 'assets.listLinkedObservations', {
        assetId: world.a.assets.root as string,
      });
      const titles = res.ok
        ? ((res.value as Array<{ title: string }>) ?? []).map((r) => r.title)
        : [];
      expect({ disclosedTitles: titles }).toEqual({ disclosedTitles: [] });
    });

    it('AS-X02 · the same endpoint still works for somebody who holds issues.view', async () => {
      // The other half: fixing AS-X01 must not blind the people who are
      // entitled to the link.
      const res = (await asAdmin().assets.listLinkedObservations({
        assetId: world.a.assets.root as string,
      })) as Array<{ id: string }>;
      expect(res.map((r) => r.id)).toContain(world.a.linkedIssueId);
    });

    it('AS-X03 · linked actions and inspections are gated on their own modules too', async () => {
      // Same shape, same two endpoints beside it. Both are `assets.view`
      // only. Asserted together because the fix is one decision, not three.
      const caller = asAssetOnly();
      const results: Record<string, boolean> = {};
      for (const path of ['assets.listLinkedActions', 'assets.listLinkedInspections']) {
        const res = await callFor(caller, path, { assetId: world.a.assets.root as string });
        results[path] = res.ok;
      }
      expect(results).toEqual({
        'assets.listLinkedActions': false,
        'assets.listLinkedInspections': false,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AS-H — hierarchy
  // ═══════════════════════════════════════════════════════════════════════
  describe('AS-H · hierarchy', () => {
    it('AS-H01 · an asset cannot be its own parent', async () => {
      const res = await callFor(asAdmin(), 'assets.update', {
        assetId: world.a.assets.root as string,
        parentId: world.a.assets.root as string,
      });
      expect(res.ok).toBe(false);
    });

    it('AS-H02 · the tree is capped at one level, so a cycle cannot be built', async () => {
      // `assets.parent_id` carries NO foreign key and no ON DELETE rule, so
      // there is nothing at the database level stopping a cycle. The depth
      // cap is the whole guard: a parent may not itself have a parent.
      // Re-parenting the root under its own child is the shortest cycle
      // there is, and it must be refused.
      const res = await callFor(asAdmin(), 'assets.update', {
        assetId: world.a.assets.root as string,
        parentId: world.a.assets.child as string,
      });
      expect(res.ok).toBe(false);
    });

    it('AS-H03 · a parent holding sub-assets cannot be archived', async () => {
      // `assets.parent_id` carries NO foreign key and no ON DELETE rule, so
      // nothing at the database level would stop an archived parent leaving
      // its children pointing at it. The router closes that by refusing the
      // archive outright while children remain, and names the count in the
      // error so the UI can say how many. That is the stronger of the two
      // possible designs and it is what ships.
      const admin = asAdmin();
      const { assetId: parentId } = await admin.assets.create({ name: 'Temp parent' });
      await admin.assets.create({ name: 'Temp child', parentId });

      const res = await callFor(admin, 'assets.archive', { assetId: parentId });
      expect({ archivedAParentWithChildren: res.ok }).toEqual({
        archivedAParentWithChildren: false,
      });
      if (!res.ok) expect(res.message).toContain('asset-has-sub-assets');
    });

    it('AS-H04 · an archived asset is out of the default listing but still readable by id', async () => {
      const list = (await asAdmin().assets.list({})) as
        | { assets?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(list) ? list : (list.assets ?? []);
      expect(rows.some((a) => a.id === world.a.assets.archived)).toBe(false);

      const got = await callFor(asAdmin(), 'assets.get', {
        assetId: world.a.assets.archived as string,
      });
      expect(got.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AS-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('AS-T · tenancy', () => {
    it('AS-T01 · the register never contains another tenant assets', async () => {
      const list = (await asAdmin().assets.list({ limit: 500 })) as
        | { assets?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(list) ? list : (list.assets ?? []);
      const foreign = new Set(Object.values(world.b.assets));
      expect(rows.filter((a) => foreign.has(a.id))).toEqual([]);
    });

    it('AS-T02 · another tenant asset is unreadable and unmutatable', async () => {
      const foreignId = world.b.assets.root as string;
      for (const [path, input] of [
        ['assets.get', { assetId: foreignId }],
        ['assets.update', { assetId: foreignId, name: 'Cross-tenant rename' }],
        ['assets.archive', { assetId: foreignId }],
        [
          'assets.readings.add',
          { assetId: foreignId, fieldName: 'Engine hours', value: 1, unit: 'h' },
        ],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({ name: schema.assets.name, archivedAt: schema.assets.archivedAt })
        .from(schema.assets)
        .where(eq(schema.assets.id, foreignId));
      expect(row?.name).toBe('FLT-01 — Counterbalance');
      expect(row?.archivedAt).toBeNull();
    });

    it('AS-T02b · the linked-record readers never return another tenant rows', async () => {
      // These three are scoped on the LINK table's tenant rather than by
      // loading the asset first, so a foreign asset id yields an empty array
      // instead of NOT_FOUND. No data crosses — which is what matters — but
      // the contract differs from every sibling in the router, and an empty
      // list is indistinguishable from "this asset has no observations".
      const foreignId = world.b.assets.root as string;
      for (const path of [
        'assets.listLinkedObservations',
        'assets.listLinkedActions',
        'assets.listLinkedInspections',
      ]) {
        const res = await callFor(asAdmin(), path, { assetId: foreignId });
        const rows = res.ok ? ((res.value as unknown[]) ?? []) : [];
        expect({ path, rows: rows.length }).toEqual({ path, rows: 0 });
      }
    });

    it('AS-T03 · an asset cannot be parented under another tenant asset', async () => {
      const res = await callFor(asAdmin(), 'assets.create', {
        name: 'Cross-tenant child',
        parentId: world.b.assets.root as string,
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('AS-T04 · an asset cannot take another tenant type, site or owner', async () => {
      for (const [label, patch] of [
        ['type', { typeId: world.b.assets.type as string }],
        ['site', { siteId: world.b.sites.primary }],
        ['owner', { ownerUserId: world.b.actors.manager }],
      ] as Array<[string, Record<string, unknown>]>) {
        const res = await callFor(asAdmin(), 'assets.update', {
          assetId: world.a.assets.root as string,
          ...patch,
        });
        expect({ label, accepted: res.ok }).toEqual({ label, accepted: false });
      }
    });

    it('AS-T05 · a QR token is unique across the whole table, not just per tenant', async () => {
      // `qr_token` carries a global unique index, and the generator retries
      // on collision. Pinned because the token is meant to be printed on
      // physical signage: two tenants resolving the same sticker would be
      // the worst possible failure of a code nobody can re-print cheaply.
      const rows = await world.db.select({ token: schema.assets.qrToken }).from(schema.assets);
      const tokens = rows.map((r) => r.token).filter((t): t is string => t !== null);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AS-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('AS-V · volume', () => {
    it('AS-V01 · the register can reach past its own cap', async () => {
      // `listInput.limit` is capped at 500 with a default of 200 and there is
      // no cursor at all, so a company with more plant than that simply
      // cannot see the rest — and nothing on the response says so. The
      // fixture seeds 520 to put that beyond argument.
      const total = await world.db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(eq(schema.assets.tenantId, world.a.tenantId));
      expect(total.length).toBeGreaterThan(500);

      const res = (await asAdmin().assets.list({ limit: 500 })) as
        | { assets?: Array<{ id: string }>; hasMore?: boolean; nextCursor?: string | null }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.assets ?? []);
      const paging = Array.isArray(res) ? undefined : res;

      // Either the response pages, or it at least admits it is truncated.
      const reachable =
        paging?.nextCursor != null || paging?.hasMore === true || rows.length >= total.length;
      expect({ canReachEveryAsset: reachable }).toEqual({ canReachEveryAsset: true });
    });

    it('AS-V02 · the register holds its shape at 520 assets', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().assets.list({ limit: 500 })) as
        | { assets?: unknown[] }
        | unknown[];
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rows = Array.isArray(res) ? res : (res.assets ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('AS-V03 · the parent/child tree view holds at volume', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().assets.listWithChildren()) as unknown[];
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      expect(Array.isArray(res)).toBe(true);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('AS-V04 · readings come back newest-first and complete for one asset', async () => {
      const res = (await asAdmin().assets.readings.list({
        assetId: world.a.assets.root as string,
      })) as Array<{ value: string; capturedAt: Date }>;
      expect(res.length).toBeGreaterThanOrEqual(2);
      const times = res.map((r) => new Date(r.capturedAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });
  });
});
