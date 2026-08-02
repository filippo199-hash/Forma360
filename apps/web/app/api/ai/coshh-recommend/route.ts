/**
 * Control-recommendation endpoint for a COSHH assessment.
 *
 * Loads the substance's real hazard profile + the assessment's exposure
 * picture server-side (never trusting client-supplied hazard data) and
 * returns suggested hierarchy-of-control entries, substitution-first.
 * Suggestions only — the UI persists accepted ones via normal tRPC
 * mutations, so the deterministic router stays the single write path.
 *
 * Auth: session + `coshh.manage`; brand-gated; rate-limited.
 */
import { coshhAssessments, coshhSubstances } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { brandHasModule } from '@forma360/shared/brand';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { activeBrand } from '../../../../src/lib/brand';
import { recommendCoshhControls } from '../../../../src/server/coshh-ai';
import { db } from '../../../../src/server/db';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { createContext } from '../../../../src/server/trpc';

const bodySchema = z.object({ assessmentId: z.string().length(26) });

export async function POST(request: Request) {
  if (!brandHasModule(activeBrand.id, 'coshh')) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('coshh.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rl = await rateLimit(`ai:coshh-recommend:${ctx.auth.userId}`, {
    limit: 20,
    windowSec: 300,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  const [assessment] = await db
    .select()
    .from(coshhAssessments)
    .where(
      and(
        eq(coshhAssessments.id, parsed.data.assessmentId),
        eq(coshhAssessments.tenantId, ctx.auth.tenantId),
      ),
    )
    .limit(1);
  if (assessment === undefined) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const [substance] = await db
    .select()
    .from(coshhSubstances)
    .where(eq(coshhSubstances.id, assessment.substanceId))
    .limit(1);
  if (substance === undefined) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const recommendation = await recommendCoshhControls({
      substanceName: substance.name,
      physicalForm: substance.physicalForm,
      hazardClassification: substance.hazardClassification,
      hStatements: substance.hStatements,
      regimes: {
        carcinogen: substance.isCarcinogen,
        mutagen: substance.isMutagen,
        asthmagen: substance.isAsthmagen,
        biologicalAgent: substance.isBiologicalAgent,
        lead: substance.containsLead,
      },
      workplaceExposureLimits: substance.workplaceExposureLimits,
      taskDescription: assessment.taskDescription,
      routesOfExposure: assessment.routesOfExposure,
      quantityBand: assessment.quantityBand,
      frequencyBand: assessment.frequencyBand,
      durationBand: assessment.durationBand,
    });
    return Response.json({ recommendation });
  } catch (err) {
    ctx.logger.warn({ err }, '[coshh-recommend] failed');
    return Response.json({ error: 'Could not draft recommendations.' }, { status: 422 });
  }
}
