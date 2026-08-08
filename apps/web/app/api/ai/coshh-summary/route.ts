/**
 * Plain-language task-summary endpoint for a COSHH assessment.
 *
 * Drafts the "for the people using the substance" summary from the
 * assessment's real data (loaded server-side) in the caller's locale.
 * The draft comes back to the editor for review — saving it is a normal
 * `coshh.assessments.update` with `plainSummary`.
 *
 * Auth: session + `coshh.manage`; brand-gated; rate-limited.
 */
import { coshhAssessmentControls, coshhAssessments, coshhSubstances } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { brandHasModule } from '@forma360/shared/brand';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { activeBrand } from '../../../../src/lib/brand';
import { writeCoshhPlainSummary } from '../../../../src/server/coshh-ai';
import { db } from '../../../../src/server/db';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { createContext } from '../../../../src/server/trpc';

const bodySchema = z.object({
  assessmentId: z.string().length(26),
  locale: z.string().min(2).max(10).default('en'),
});

// A COSHH control recommendation genuinely takes tens of seconds. Say
// so, rather than letting a platform default cut it off mid-answer.
export const maxDuration = 120;

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
  const rl = await rateLimit(`ai:coshh-summary:${ctx.auth.userId}`, { limit: 20, windowSec: 300 });
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
  const controls = await db
    .select()
    .from(coshhAssessmentControls)
    .where(eq(coshhAssessmentControls.assessmentId, assessment.id));

  try {
    const summary = await writeCoshhPlainSummary({
      substanceName: substance.name,
      signalWord: substance.signalWord,
      hStatements: substance.hStatements,
      taskDescription: assessment.taskDescription,
      routesOfExposure: assessment.routesOfExposure,
      controls: controls.map((c) => ({ tier: c.tier, description: c.description })),
      emergencyNotes: assessment.emergencyNotes,
      locale: parsed.data.locale,
    });
    return Response.json({ summary });
  } catch (err) {
    ctx.logger.warn({ err }, '[coshh-summary] failed');
    return Response.json({ error: 'Could not draft the summary.' }, { status: 422 });
  }
}
