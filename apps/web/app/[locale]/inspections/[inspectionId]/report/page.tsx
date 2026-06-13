'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { ShareLinkDialog } from '../../../../../src/components/share-link-dialog';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Inspection report page — shows key metadata, download / share
 * actions, and an inline HTML preview of the report.
 *
 * The preview is loaded in an `<iframe>` that points to
 * `/api/exports/preview?inspectionId=…`. That endpoint mints an HMAC
 * token server-side and redirects to the print-layout route
 * `/render/inspection/<id>?token=…`, so the secret never reaches the
 * browser. The iframe shows exactly the same markup that Puppeteer
 * captures when producing the PDF.
 */
export default function InspectionReportPage() {
  const params = useParams<{ locale: string; inspectionId: string }>();
  const inspectionId = params.inspectionId ?? '';
  const locale = params.locale ?? 'en';

  const t = useTranslations('inspections.reportPage');
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );

  if (insp.isLoading || insp.data === undefined) {
    if (insp.error !== null && insp.error !== undefined) {
      return (
        <p role="alert" className="p-6 text-sm text-destructive">
          {insp.error.data?.code === 'NOT_FOUND' ? tConduct('notFound') : tCommon('error')}
        </p>
      );
    }
    return (
      <div className="space-y-4 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-[700px] w-full" />
      </div>
    );
  }

  const { inspection, approvals } = insp.data;
  const approvedRow = approvals.find((a) => a.decision === 'approved');

  return (
    <div className="space-y-6 px-4 py-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{inspection.title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
            {inspection.documentNumber !== null ? (
              <span>{inspection.documentNumber}</span>
            ) : null}
            {inspection.completedAt !== null ? (
              <span>
                {t('completedAt', { time: new Date(inspection.completedAt).toLocaleDateString() })}
              </span>
            ) : null}
            {approvedRow !== undefined ? (
              <span>{t('approvedBy', { user: approvedRow.approverUserId })}</span>
            ) : null}
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/${locale}/inspections`}>{t('back')}</Link>
        </Button>
      </header>

      {/* ── Download / share actions ────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Button asChild>
            <a
              href={`/api/exports/pdf?inspectionId=${inspection.id}`}
              download
            >
              {t('downloadPdf')}
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a
              href={`/api/exports/docx?inspectionId=${inspection.id}`}
              download
            >
              {t('downloadWord')}
            </a>
          </Button>
          <ShareLinkDialog inspectionId={inspection.id} />
        </CardContent>
      </Card>

      {/* ── Inline report preview ────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t('previewTitle')}</h2>
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          {/*
            The iframe loads /api/exports/preview which mints an HMAC
            token server-side and redirects to the print-layout route.
            The render route renders the same HTML the PDF renderer uses,
            so this is a pixel-accurate preview of the final report.
          */}
          <iframe
            src={`/api/exports/preview?inspectionId=${inspection.id}`}
            className="min-h-[900px] w-full"
            title={t('previewTitle')}
          />
        </div>
      </div>
    </div>
  );
}
