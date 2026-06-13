'use client';

import type { Page, Section, Item, TemplateContent } from '@forma360/shared/template-schema';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { ShareLinkDialog } from '../../../../../src/components/share-link-dialog';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Inspection report page.
 *
 * Renders the full inspection content inline — pages, sections, items
 * with responses, signatures, and approvals — together with download
 * and share actions. Data comes entirely from `inspections.get` so
 * there is no HMAC dance, no iframe, and no Chromium dependency on this
 * path. The PDF / Word downloads still go through the existing
 * `/api/exports/…` endpoints.
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

  const { inspection, version, signatures, approvals } = insp.data;
  const approvedRow = approvals.find((a) => a.decision === 'approved');
  // version.content is typed as TemplateContent from the DB schema
  const content = version.content as TemplateContent;

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
                {t('completedAt', {
                  time: new Date(inspection.completedAt).toLocaleDateString(),
                })}
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
            <a href={`/api/exports/pdf?inspectionId=${inspection.id}`} download>
              {t('downloadPdf')}
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/exports/docx?inspectionId=${inspection.id}`} download>
              {t('downloadWord')}
            </a>
          </Button>
          <ShareLinkDialog inspectionId={inspection.id} />
        </CardContent>
      </Card>

      {/* ── Inline report preview ────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t('previewTitle')}</h2>
        <ReportBody
          content={content}
          responses={inspection.responses as Record<string, unknown>}
          signatures={signatures}
          approvals={approvals}
          t={t}
        />
      </div>
    </div>
  );
}

// ─── Report body ─────────────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslations<'inspections.reportPage'>>;

interface SigRow {
  id: string;
  slotIndex: number;
  signerName: string;
  signerRole: string | null;
  signatureData: string;
  signedAt: Date | string | null;
}

interface ApprovalRow {
  id: string;
  decision: string;
  approverUserId: string;
  comment: string | null;
  decidedAt: Date | string | null;
}

function ReportBody({
  content,
  responses,
  signatures,
  approvals,
  t,
}: {
  content: TemplateContent;
  responses: Record<string, unknown>;
  signatures: SigRow[];
  approvals: ApprovalRow[];
  t: TFunc;
}) {
  // Filter to inspection pages only (skip title pages and approval page)
  const inspectionPages = content.pages.filter((p) => p.type === 'inspection');

  return (
    <div className="space-y-8 rounded-lg border bg-card p-6 shadow-sm">
      {inspectionPages.map((page) => (
        <ReportPage key={page.id} page={page} responses={responses} />
      ))}

      {signatures.length > 0 ? (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-base font-semibold">{t('signaturesHeading')}</h2>
          <div className="space-y-3">
            {signatures.map((sig) => (
              <div key={sig.id} className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {t('signSlot', { index: sig.slotIndex + 1 })}: {sig.signerName}
                  {sig.signerRole !== null ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({sig.signerRole})
                    </span>
                  ) : null}
                </p>
                {sig.signedAt !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {t('signedAt', { time: new Date(sig.signedAt).toLocaleString() })}
                  </p>
                ) : null}
                {sig.signatureData.startsWith('data:') ? (
                  // Render the base64 signature via CSS background-image so
                  // we avoid next/image (which can't optimise a data URL) and
                  // the no-img-element lint rule.
                  <div
                    className="mt-2 h-16 w-48 rounded border bg-white"
                    style={{
                      backgroundImage: `url('${sig.signatureData}')`,
                      backgroundSize: 'contain',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'center',
                    }}
                    role="img"
                    aria-label={`Signature slot ${sig.slotIndex + 1}`}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {approvals.length > 0 ? (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-base font-semibold">{t('approvalsHeading')}</h2>
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium capitalize">{a.decision}</span>
                  {' · '}
                  {a.approverUserId}
                  {a.decidedAt !== null ? (
                    <span className="ml-1 text-muted-foreground">
                      · {new Date(a.decidedAt).toLocaleString()}
                    </span>
                  ) : null}
                </p>
                {a.comment !== null ? (
                  <p className="mt-1 text-muted-foreground">{a.comment}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ReportPage({
  page,
  responses,
}: {
  page: Page;
  responses: Record<string, unknown>;
}) {
  return (
    <section className="space-y-4">
      <h2 className="border-b pb-2 text-lg font-semibold">{page.title}</h2>
      {page.sections.map((section) => (
        <ReportSection key={section.id} section={section} responses={responses} />
      ))}
    </section>
  );
}

function ReportSection({
  section,
  responses,
}: {
  section: Section;
  responses: Record<string, unknown>;
}) {
  const visibleItems = section.items.filter(
    (item) => 'prompt' in item || 'type' in item,
  ) as Item[];
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {section.title}
      </h3>
      <div className="space-y-2">
        {visibleItems.map((item) => (
          <ReportItem key={item.id} item={item} response={responses[item.id]} />
        ))}
      </div>
    </div>
  );
}

function ReportItem({ item, response }: { item: Item; response: unknown }) {
  const prompt = 'prompt' in item ? item.prompt : null;
  if (prompt === null) return null;

  const answered = response !== undefined && response !== null && response !== '';
  const displayValue = stringifyResponse(response);

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 rounded-md border bg-background px-3 py-2.5 text-sm">
      <span className="font-medium leading-snug">{prompt}</span>
      <span
        className={
          answered
            ? 'text-right font-medium'
            : 'text-right text-muted-foreground italic'
        }
      >
        {answered ? displayValue : '—'}
      </span>
    </div>
  );
}

function stringifyResponse(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return (v as unknown[])
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(', ');
  }
  if (typeof v === 'object' && 'value' in (v as object)) {
    return String((v as { value: unknown }).value);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserialisable]';
  }
}
