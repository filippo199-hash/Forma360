'use client';

import type { TemplateContent } from '@forma360/shared/template-schema';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ConductProvider } from '../../../../src/components/inspections/conduct-context';
import { ConductShell } from '../../../../src/components/inspections/conduct-shell';
import type { ConductState, Responses } from '../../../../src/components/inspections/conduct-state';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Conduct view. Fetches the inspection + pinned template version, seeds
 * the reducer and mounts the shell. Loading / not-found are rendered
 * inline so the shell always renders against real data.
 */
export default function InspectionConductPage() {
  const params = useParams<{ locale: string; inspectionId: string }>();
  const inspectionId = params.inspectionId ?? '';
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );

  useEffect(() => {
    if (insp.data !== undefined) {
      document.title = insp.data.inspection.title;
    }
  }, [insp.data]);

  if (insp.isLoading || insp.data === undefined) {
    if (insp.error !== null && insp.error !== undefined) {
      return (
        <p role="alert" className="p-6 text-sm text-destructive">
          {insp.error.data?.code === 'NOT_FOUND' ? tConduct('notFound') : tCommon('error')}
        </p>
      );
    }
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { inspection, version } = insp.data;
  // Version.content is validated at write time and comes back typed
  // `unknown` — trust it here; a malformed blob throws downstream rather
  // than silently rendering empty state.
  const content = version.content as TemplateContent;
  const initial: Omit<ConductState, 'saveStatus'> = {
    content,
    inspectionId: inspection.id,
    title: inspection.title,
    documentNumber: inspection.documentNumber,
    inspectionStatus: inspection.status,
    startedAt: inspection.startedAt.toISOString(),
    conductedByUserId: inspection.conductedBy ?? inspection.createdBy,
    responses: inspection.responses as Responses,
    loadedUpdatedAt: inspection.updatedAt.toISOString(),
    selectedPageId: content.pages[0]?.id ?? '',
  };

  return (
    <ConductProvider initial={initial}>
      <ConductShell />
    </ConductProvider>
  );
}
