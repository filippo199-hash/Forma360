/**
 * Admin utility router — Phase 2 PR 33.
 *
 *   - previewDependents (tenantProcedure) — runs the `getDependents`
 *     registry (see `@forma360/permissions/dependents`) for a given
 *     entity + id and returns a sorted `[{module, count}]` list.
 *     Used by the reusable ArchiveDialog in the web UI to warn
 *     admins about cascading effects before they commit.
 *
 *     No additional permission gate is layered here: the caller must
 *     also hold the entity-specific archive/delete permission, which
 *     is enforced on the actual mutation (e.g. `templates.archive`,
 *     `groups.archive`). Previewing alone is cheap and leaks no data
 *     beyond counts-per-module within the caller's tenant.
 */
import { getDependents } from '@forma360/permissions/dependents';
import { z } from 'zod';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

const dependentEntity = z.enum([
  'tenant',
  'group',
  'site',
  'user',
  'permissionSet',
  'customUserField',
  'accessRule',
  'template',
  'inspection',
  'action',
]);

const previewDependentsInput = z.object({
  entity: dependentEntity,
  id: z.string().min(1).max(64),
});

export const adminRouter = router({
  previewDependents: tenantProcedure
    .input(previewDependentsInput)
    .query(async ({ ctx, input }) => {
      const counts = await getDependents(
        { db: ctx.db },
        { entity: input.entity, id: input.id, tenantId: ctx.tenantId },
      );
      return Object.entries(counts)
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
    }),
});
