/**
 * Documents module — the audit suite (FreeHS).
 *
 * The third module through the testing runbook, and the one the platform
 * leans on hardest: RAMS packs, COSHH sheets and fire risk assessments all
 * hang evidence off it, and it is the only module that ships its **own**
 * access-control layer on top of the permission catalogue.
 *
 * That layer is the reason this audit exists. `document-visibility.ts`
 * implements four interacting rules —
 *
 *   1. a document's own group/site visibility,
 *   2. every ancestor folder's visibility, cascading down,
 *   3. an explicit ACL grant on the document, and
 *   4. an explicit ACL grant on any ancestor folder,
 *
 * — and the module's own comment says callers holding `documents.manage`
 * "must bypass this themselves; this function makes no permission
 * assumptions". Four rules and a manual opt-in across a dozen read paths is
 * precisely the shape that leaks one path, and no amount of reading proves
 * it does not: the only way to know is to build a restricted document and a
 * viewer outside the restriction and ask every read path in turn.
 *
 * Five axes:
 *
 *   1. **DC-P — the generated permission matrix.** Every `documents.*`,
 *      `documentFolders.*` and `documentLabels.*` procedure enumerated from
 *      the router at runtime and called by a user holding no documents key.
 *
 *   2. **DC-A — access control.** The four rules above, asserted against a
 *      real viewer through *every* read path the module exposes, including
 *      global search, which reaches documents from outside the module.
 *
 *   3. **DC-T — tenancy.** Ground rule 4, against the mirror tenant.
 *
 *   4. **DC-F — folder integrity.** Cycles, deletion with contents, and the
 *      cascade the visibility layer depends on.
 *
 *   5. **DC-V — volume.** ~90 documents against the codebase's default
 *      page sizes.
 *
 * Every test describes CORRECT behaviour. Those that name a live defect
 * fail today and are the acceptance criteria for the fix pass.
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

/** Documents procedures reachable without a `documents.*` key. None, by design. */
const DECLARED_OPEN: Record<string, string> = {};

function documentProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter(
      (k) =>
        k.startsWith('documents.') ||
        k.startsWith('documentFolders.') ||
        k.startsWith('documentLabels.'),
    )
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

describe('documents — audit suite', () => {
  let world: World;
  let client: PGlite;

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  /** Holds `documents.view` and belongs to no group and no site. */
  const asOutsider = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.standard));
  /** Holds `documents.view` and is in the Night shift group. */
  const asGroupMember = () =>
    createCaller(world.ctxFor(world.a.tenantId, world.a.actors.trainingViewer));
  /** Holds every key, and is a member of the primary site. */
  const asManager = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));

  // ═══════════════════════════════════════════════════════════════════════
  // DC-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('DC-P · permissions', () => {
    it('DC-P00 · the matrix covers every documents procedure the router exposes', () => {
      const procs = documentProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(20);
      expect(procs).toContain('documents.list');
      expect(procs).toContain('documentFolders.list');
      expect(procs).toContain('documentLabels.list');
    });

    it('DC-P01 · every procedure refuses a user holding no documents key', async () => {
      // The seeded Standard set DOES hold `documents.view`, so this uses a
      // custom set holding nothing at all — the "contractor portal user who
      // was granted the wrong activity" case.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of documentProcedures()) {
        if (path in DECLARED_OPEN) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('DC-P02 · a documents.view holder cannot mutate documents, folders or labels', async () => {
      const caller = asOutsider();
      const docId = world.a.documents.publicDoc as string;
      for (const [path, input] of [
        [
          'documents.create',
          {
            name: 'Should not exist',
            storageKey: 'x',
            filename: 'x.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 10,
          },
        ],
        ['documents.update', { documentId: docId, name: 'Renamed' }],
        ['documents.archive', { documentId: docId }],
        [
          'documents.access.grant',
          {
            documentId: docId,
            subjectType: 'user',
            subjectId: world.a.actors.manager,
            permission: 'view',
          },
        ],
        ['documentFolders.create', { name: 'Should not exist' }],
        ['documentLabels.create', { name: 'Should not exist' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('DC-P03 · folder management is a distinct key from document management', async () => {
      // `documents.folders.manage` exists as its own key. If it is not
      // actually enforced apart from `documents.manage`, the catalogue is
      // promising a separation the server does not implement — the same
      // class of defect as the contractors gate key.
      const setId = newId();
      await world.db.insert(schema.permissionSets).values({
        id: setId,
        tenantId: world.a.tenantId,
        name: 'Documents — no folder rights',
        permissions: ['documents.view', 'documents.manage'],
      });
      const userId = newId();
      await world.db.insert(schema.user).values({
        id: userId,
        tenantId: world.a.tenantId,
        name: 'Dee DocsOnly',
        email: 'docs-only@northgate.test',
        permissionSetId: setId,
      });
      const caller = createCaller(world.ctxFor(world.a.tenantId, userId));

      const canCreateDoc = await callFor(caller, 'documents.create', {
        name: 'Allowed by documents.manage',
        storageKey: `${world.a.tenantId}/documents/${newId()}/f.pdf`,
        filename: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
      const canCreateFolder = await callFor(caller, 'documentFolders.create', {
        name: 'Should need folders.manage',
      });

      expect({ doc: canCreateDoc.ok, folder: canCreateFolder.ok }).toEqual({
        doc: true,
        folder: false,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DC-A — access control, through every read path
  // ═══════════════════════════════════════════════════════════════════════
  describe('DC-A · document visibility', () => {
    /** Every read path that can return a document, by name. */
    async function readableBy(
      caller: Caller,
      documentId: string,
    ): Promise<Record<string, boolean>> {
      const listed = (await callFor(caller, 'documents.list', {})) as
        | { ok: true; value: { documents?: Array<{ id: string }> } | Array<{ id: string }> }
        | { ok: false };
      const rows = !listed.ok
        ? []
        : Array.isArray(listed.value)
          ? listed.value
          : (listed.value.documents ?? []);

      const got = await callFor(caller, 'documents.get', { documentId });
      const versions = await callFor(caller, 'documents.versions.list', { documentId });
      const sigs = await callFor(caller, 'documents.signatureRequests', { documentId });

      return {
        list: rows.some((d) => d.id === documentId),
        get: got.ok,
        versions: versions.ok,
        signatureRequests: sigs.ok,
      };
    }

    it('DC-A01 · a public document is readable through every path', async () => {
      const paths = await readableBy(asOutsider(), world.a.documents.publicDoc as string);
      expect(paths).toEqual({ list: true, get: true, versions: true, signatureRequests: true });
    });

    it('DC-A02 · a group-restricted document is hidden from a non-member on EVERY path', async () => {
      // The point of asking every path rather than just `list`: the module
      // enforces visibility per-caller rather than in one place, so a single
      // forgotten `assertDocumentVisibleOrThrow` is a silent read-anything
      // hole for the one document class that is restricted on purpose.
      const paths = await readableBy(asOutsider(), world.a.documents.groupRestrictedDoc as string);
      expect(paths).toEqual({ list: false, get: false, versions: false, signatureRequests: false });
    });

    it('DC-A03 · the same document is readable by a member of that group', async () => {
      const paths = await readableBy(
        asGroupMember(),
        world.a.documents.groupRestrictedDoc as string,
      );
      expect(paths).toEqual({ list: true, get: true, versions: true, signatureRequests: true });
    });

    it('DC-A04 · a site-restricted document is hidden from a non-member and shown to a member', async () => {
      const outsider = await readableBy(
        asOutsider(),
        world.a.documents.siteRestrictedDoc as string,
      );
      const member = await readableBy(asManager(), world.a.documents.siteRestrictedDoc as string);
      expect({ outsiderGet: outsider.get, memberGet: member.get }).toEqual({
        outsiderGet: false,
        memberGet: true,
      });
    });

    it('DC-A05 · an unrestricted document inside a restricted folder inherits the restriction', async () => {
      // The cascade. A read path that filters only on the document row lets
      // this one through: the row itself carries no groups and no sites.
      const paths = await readableBy(
        asOutsider(),
        world.a.documents.inheritsFolderRestriction as string,
      );
      expect(paths).toEqual({ list: false, get: false, versions: false, signatureRequests: false });
    });

    it('DC-A06 · the cascade reaches a grandchild folder, not just the immediate parent', async () => {
      const paths = await readableBy(
        asOutsider(),
        world.a.documents.inheritsGrandparentRestriction as string,
      );
      expect(paths.get).toBe(false);
      const member = await readableBy(
        asGroupMember(),
        world.a.documents.inheritsGrandparentRestriction as string,
      );
      expect(member.get).toBe(true);
    });

    it('DC-A07 · an explicit user grant admits an outsider to a restricted document', async () => {
      // PF-26 from the platform review: `document_access` was written by
      // grant/revoke and consulted by no read path. The fixture grants the
      // outsider one group-restricted document by name; they must see that
      // one and still not see its unglanted sibling.
      const granted = await readableBy(asOutsider(), world.a.documents.grantedToOutsider as string);
      const sibling = await readableBy(
        asOutsider(),
        world.a.documents.groupRestrictedDoc as string,
      );
      expect({ granted: granted.get, sibling: sibling.get }).toEqual({
        granted: true,
        sibling: false,
      });
    });

    it('DC-A08 · revoking the grant closes the door again', async () => {
      const admin = asAdmin();
      const docId = world.a.documents.grantedToOutsider as string;
      const before = await readableBy(asOutsider(), docId);
      expect(before.get).toBe(true);

      const grants = (await admin.documents.access.list({ documentId: docId })) as Array<{
        id: string;
        subjectId: string;
      }>;
      const mine = grants.find((g) => g.subjectId === world.a.actors.standard);
      expect(mine).toBeDefined();
      await admin.documents.access.revoke({ accessId: mine?.id as string });
      const after = await readableBy(asOutsider(), docId);
      expect({ beforeGet: before.get, afterGet: after.get }).toEqual({
        beforeGet: true,
        afterGet: false,
      });

      // Restore, so later tests see the seeded world.
      await admin.documents.access.grant({
        documentId: docId,
        subjectType: 'user',
        subjectId: world.a.actors.standard,
        permission: 'view',
      });
    });

    it('DC-A09 · global search does not leak a restricted document', async () => {
      // Search reaches documents from outside the module, which is exactly
      // where a per-module access rule gets forgotten. The document is named
      // distinctively so a hit is unambiguous.
      const res = (await asOutsider().search.global({ query: 'Night shift rota' })) as {
        documents?: Array<{ id: string; title: string }>;
      };
      const ids = new Set((res.documents ?? []).map((d) => d.id));
      expect({
        outsiderSeesRestricted: ids.has(world.a.documents.groupRestrictedDoc as string),
      }).toEqual({ outsiderSeesRestricted: false });
    });

    it('DC-A10 · global search still finds it for someone entitled to it', async () => {
      const res = (await asGroupMember().search.global({ query: 'Night shift rota' })) as {
        documents?: Array<{ id: string }>;
      };
      const ids = new Set((res.documents ?? []).map((d) => d.id));
      expect(ids.has(world.a.documents.groupRestrictedDoc as string)).toBe(true);
    });

    it('DC-A11 · a manager bypasses visibility, as documented', async () => {
      // `documents.manage` is the documented bypass. Asserted so that if the
      // bypass is ever removed the change is deliberate rather than a
      // surprise to every admin screen.
      const paths = await readableBy(asManager(), world.a.documents.groupRestrictedDoc as string);
      expect(paths.get).toBe(true);
    });

    it('DC-A12 · the folder tree hides a folder the viewer may not see', async () => {
      const outsider = (await asOutsider().documentFolders.list()) as Array<{ id: string }>;
      const member = (await asGroupMember().documentFolders.list()) as Array<{ id: string }>;
      const restricted = world.a.folders.groupFolder as string;
      expect({
        outsiderSees: outsider.some((f) => f.id === restricted),
        memberSees: member.some((f) => f.id === restricted),
      }).toEqual({ outsiderSees: false, memberSees: true });
    });

    it('DC-A13 · an archived document is out of the default listing', async () => {
      const res = (await asAdmin().documents.list({})) as
        | { documents?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.documents ?? []);
      expect(rows.some((d) => d.id === world.a.documents.archivedDoc)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DC-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('DC-T · tenancy', () => {
    it('DC-T01 · the listing never contains another tenant documents', async () => {
      const res = (await asAdmin().documents.list({})) as
        | { documents?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.documents ?? []);
      const foreign = new Set(Object.values(world.b.documents));
      expect(rows.filter((d) => foreign.has(d.id))).toEqual([]);
    });

    it('DC-T02 · another tenant document is not readable by id', async () => {
      for (const path of [
        'documents.get',
        'documents.versions.list',
        'documents.signatureRequests',
      ]) {
        const res = await callFor(asAdmin(), path, {
          documentId: world.b.documents.publicDoc as string,
        });
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('DC-T03 · another tenant document cannot be mutated', async () => {
      const foreignId = world.b.documents.publicDoc as string;
      for (const [path, input] of [
        ['documents.update', { documentId: foreignId, name: 'Cross-tenant rename' }],
        ['documents.archive', { documentId: foreignId }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({ name: schema.documents.name, archivedAt: schema.documents.archivedAt })
        .from(schema.documents)
        .where(eq(schema.documents.id, foreignId));
      expect(row?.name).toBe('Health and safety policy');
      expect(row?.archivedAt).toBeNull();
    });

    it('DC-T04 · a document cannot be filed into another tenant folder', async () => {
      const res = await callFor(asAdmin(), 'documents.create', {
        name: 'Cross-tenant filing',
        folderId: world.b.folders.publicFolder as string,
        storageKey: `${world.a.tenantId}/documents/${newId()}/f.pdf`,
        filename: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('DC-T05 · a document cannot be made visible to another tenant group or site', async () => {
      // Visibility arrays are plain jsonb with no FK, so a foreign id writes
      // cleanly and then matches nobody — a restriction that looks set and
      // silently admits everyone, or excludes everyone, depending on the
      // rule. Either way the UI shows a rule that is not the rule in force.
      // On its own document: the update currently SUCCEEDS, and doing this
      // to a shared fixture row would restrict it for every later test.
      const admin = asAdmin();
      const { documentId } = (await admin.documents.create({
        name: 'Cross-tenant visibility probe',
        storageKey: `${world.a.tenantId}/documents/${newId()}/f.pdf`,
        filename: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })) as { documentId: string };

      for (const [label, patch] of [
        ['group', { visibleToGroupIds: [world.b.training.groupId] }],
        ['site', { visibleToSiteIds: [world.b.sites.primary] }],
      ] as Array<[string, Record<string, unknown>]>) {
        const res = await callFor(admin, 'documents.update', { documentId, ...patch });
        expect({ label, accepted: res.ok }).toEqual({ label, accepted: false });
      }
    });

    it('DC-T06 · a folder cannot be reparented under another tenant folder', async () => {
      const res = await callFor(asAdmin(), 'documentFolders.update', {
        folderId: world.a.folders.publicFolder as string,
        parentId: world.b.folders.publicFolder as string,
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('DC-T07 · an ACL grant cannot name a subject from another tenant', async () => {
      const res = await callFor(asAdmin(), 'documents.access.grant', {
        documentId: world.a.documents.publicDoc as string,
        subjectType: 'user',
        subjectId: world.b.actors.manager,
        permission: 'view',
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DC-F — folder integrity
  // ═══════════════════════════════════════════════════════════════════════
  describe('DC-F · folder integrity', () => {
    it('DC-F01 · a folder cannot be made its own parent', async () => {
      const res = await callFor(asAdmin(), 'documentFolders.update', {
        folderId: world.a.folders.publicFolder as string,
        parentId: world.a.folders.publicFolder as string,
      });
      expect(res.ok).toBe(false);
    });

    it('DC-F02 · a folder cannot be reparented under its own descendant', async () => {
      // A cycle is not merely untidy: `makeFolderVisibilityChecker` seeds its
      // memo with `true` before descending, so a cycle resolves to VISIBLE.
      // An unreachable loop of folders would therefore be readable by
      // everyone, which is the wrong direction to fail in.
      const res = await callFor(asAdmin(), 'documentFolders.update', {
        folderId: world.a.folders.groupFolder as string,
        parentId: world.a.folders.nestedOpenFolder as string,
      });
      expect(res.ok).toBe(false);
    });

    it('DC-F03 · a folder holding documents cannot be deleted', async () => {
      const res = await callFor(asAdmin(), 'documentFolders.delete', {
        folderId: world.a.folders.publicFolder as string,
      });
      expect(res.ok).toBe(false);
    });

    it('DC-F04 · a folder holding sub-folders cannot be deleted', async () => {
      const res = await callFor(asAdmin(), 'documentFolders.delete', {
        folderId: world.a.folders.groupFolder as string,
      });
      expect(res.ok).toBe(false);
    });

    it('DC-F05 · tightening a parent folder immediately hides what is beneath it', async () => {
      // The cascade has to be live rather than copied at filing time,
      // otherwise restricting a folder leaves its existing contents exposed
      // — which is exactly what someone is trying to prevent when they
      // restrict it.
      const admin = asAdmin();
      const folderId = world.a.folders.publicFolder as string;
      const docId = world.a.documents.publicDoc as string;

      const before = await callFor(asOutsider(), 'documents.get', { documentId: docId });
      await admin.documentFolders.update({
        folderId,
        visibleToGroupIds: [world.a.training.groupId],
      });
      const after = await callFor(asOutsider(), 'documents.get', { documentId: docId });

      // Restore before asserting, so a failure cannot poison the suite.
      await admin.documentFolders.update({ folderId, visibleToGroupIds: [] });

      expect({ beforeVisible: before.ok, afterVisible: after.ok }).toEqual({
        beforeVisible: true,
        afterVisible: false,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DC-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('DC-V · volume', () => {
    it('DC-V01 · the listing is bounded at ~90 documents', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().documents.list({})) as
        | { documents?: Array<{ id: string }>; hasMore?: boolean }
        | Array<{ id: string }>;
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rows = Array.isArray(res) ? res : (res.documents ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('DC-V02 · visibility filtering survives volume', async () => {
      // The filter runs in JavaScript over the fetched page, so a page that
      // fills up with permitted documents could push a restricted one out of
      // sight — or, worse, a page fetched BEFORE filtering could return
      // fewer rows than the page size while more permitted rows exist.
      const res = (await asOutsider().documents.list({})) as
        | { documents?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.documents ?? []);
      const restricted = new Set([
        world.a.documents.groupRestrictedDoc as string,
        world.a.documents.siteRestrictedDoc as string,
        world.a.documents.inheritsFolderRestriction as string,
        world.a.documents.inheritsGrandparentRestriction as string,
      ]);
      expect(rows.filter((d) => restricted.has(d.id))).toEqual([]);
    });
  });
});
