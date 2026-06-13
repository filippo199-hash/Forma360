'use client';

import type { Page, Section, Item, TemplateContent } from '@forma360/shared/template-schema';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '../../../../../src/components/ui/button';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { ShareLinkDialog } from '../../../../../src/components/share-link-dialog';
import { FocusedPageShell } from '../../../../../src/components/focused-page-shell';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Inspection report page — full-screen focused view (sidebar hidden).
 *
 * Top bar:  title, Back button, Download PDF, Download Word, Share link.
 * Body:     Summary meta → Actions raised → Files uploaded → Inline report.
 *
 * Data comes entirely from tRPC (no iframe, no HMAC dance).
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

  const actionsQuery = trpc.actions.list.useQuery(
    { sourceType: 'inspection', sourceId: inspectionId },
    { enabled: inspectionId.length === 26 },
  );

  // ── Loading / error states ─────────────────────────────────────────────────

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
  const content = version.content as TemplateContent;

  // ── Build action map ───────────────────────────────────────────────────────

  type ActionRow = NonNullable<typeof actionsQuery.data>[number];
  const actionsByItemId = new Map<string, ActionRow[]>();
  const allActions: ActionRow[] = actionsQuery.data ?? [];
  for (const action of allActions) {
    if (action.sourceItemId !== null) {
      const list = actionsByItemId.get(action.sourceItemId) ?? [];
      list.push(action);
      actionsByItemId.set(action.sourceItemId, list);
    }
  }

  // ── Collect all uploaded files across every media question ─────────────────

  interface MediaFile {
    key: string;
    questionPrompt: string | null;
  }
  const allFiles: MediaFile[] = [];
  for (const page of content.pages) {
    if (page.type !== 'inspection') continue;
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!('type' in item) || item.type !== 'media') continue;
        const raw = (inspection.responses as Record<string, unknown>)[item.id];
        if (!Array.isArray(raw)) continue;
        for (const k of raw as string[]) {
          if (typeof k === 'string' && k.length > 0) {
            allFiles.push({
              key: k,
              questionPrompt: 'prompt' in item ? (item.prompt as string) : null,
            });
          }
        }
      }
    }
  }

  // ── Derive a clean filename from an R2 key ─────────────────────────────────

  function filenameFromKey(key: string): string {
    const last = key.split('/').at(-1) ?? key;
    // Keys are prefixed with a timestamp like `1abc_originalname.jpg`
    const underscoreIdx = last.indexOf('_');
    return underscoreIdx > 0 ? last.slice(underscoreIdx + 1) : last;
  }

  function isImage(key: string): boolean {
    const ext = key.split('.').at(-1)?.toLowerCase() ?? '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext);
  }

  const backHref = `/${locale}/inspections`;

  // ── Top-bar action buttons ─────────────────────────────────────────────────

  const topBarActions = (
    <>
      <Button asChild size="sm">
        <a href={`/api/exports/pdf?inspectionId=${inspection.id}`} download>
          {t('downloadPdf')}
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={`/api/exports/docx?inspectionId=${inspection.id}`} download>
          {t('downloadWord')}
        </a>
      </Button>
      <ShareLinkDialog inspectionId={inspection.id} />
    </>
  );

  return (
    <FocusedPageShell
      title={inspection.title}
      backHref={backHref}
      backLabel={t('back')}
      actions={topBarActions}
      width="wide"
    >
      <div className="space-y-6">
        {/* ── Meta summary ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {inspection.documentNumber !== null ? (
            <span className="font-mono">{inspection.documentNumber}</span>
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

        {/* ── Actions raised across the inspection ─────────────────────── */}
        {allActions.length > 0 ? (
          <section>
            <h2 className="mb-3 text-base font-semibold">{t('allActionsHeading')}</h2>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t('actionCol.title')}</th>
                    <th className="w-28 px-3 py-2">{t('actionCol.status')}</th>
                    <th className="w-24 px-3 py-2">{t('actionCol.priority')}</th>
                    <th className="w-32 px-3 py-2">{t('actionCol.assignee')}</th>
                    <th className="w-28 px-3 py-2">{t('actionCol.due')}</th>
                  </tr>
                </thead>
                <tbody>
                  {allActions.map((action) => (
                    <tr key={action.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {action.referenceNumber !== null ? (
                          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                            #{action.referenceNumber}
                          </span>
                        ) : null}
                        <Link
                          href={`/${locale}/actions/${action.id}`}
                          className="font-medium hover:underline"
                          target="_blank"
                        >
                          {action.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <ActionStatusChip status={action.status} t={t} />
                      </td>
                      <td className="px-3 py-2">
                        {action.priority !== null ? (
                          <ActionPriorityChip priority={action.priority} t={t} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {action.assigneeName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {action.dueAt !== null
                          ? new Date(action.dueAt).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* ── Files uploaded ────────────────────────────────────────────── */}
        {allFiles.length > 0 ? (
          <section>
            <h2 className="mb-3 text-base font-semibold">
              {t('filesHeading', { count: allFiles.length })}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {allFiles.map((f, i) => {
                const href = `/api/files?key=${encodeURIComponent(f.key)}`;
                const filename = filenameFromKey(f.key);
                return (
                  <a
                    key={i}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 overflow-hidden rounded-lg border bg-card p-3 hover:bg-accent/40 transition-colors"
                  >
                    {/* Thumbnail or file-type icon */}
                    {isImage(f.key) ? (
                      <div
                        className="h-14 w-14 shrink-0 rounded-md border bg-muted"
                        style={{
                          backgroundImage: `url('${href}')`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                        role="img"
                        aria-label={filename}
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-2xl">
                        📎
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium group-hover:underline">
                        {filename}
                      </p>
                      {f.questionPrompt !== null ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {f.questionPrompt}
                        </p>
                      ) : null}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* ── Inline report ─────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-base font-semibold">{t('previewTitle')}</h2>
          <ReportBody
            content={content}
            responses={inspection.responses as Record<string, unknown>}
            actionsByItemId={actionsByItemId}
            signatures={signatures}
            approvals={approvals}
            t={t}
          />
        </section>
      </div>
    </FocusedPageShell>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface ActionSummary {
  id: string;
  referenceNumber: string | null;
  title: string;
  status: string;
  priority: string | null;
  assigneeName: string | null;
  dueAt: Date | string | null;
}

// ─── Report body ─────────────────────────────────────────────────────────────

function ReportBody({
  content,
  responses,
  actionsByItemId,
  signatures,
  approvals,
  t,
}: {
  content: TemplateContent;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  signatures: SigRow[];
  approvals: ApprovalRow[];
  t: TFunc;
}) {
  const inspectionPages = content.pages.filter((p) => p.type === 'inspection');

  return (
    <div className="space-y-8 rounded-lg border bg-card p-6 shadow-sm">
      {inspectionPages.map((page) => (
        <ReportPage
          key={page.id}
          page={page}
          responses={responses}
          actionsByItemId={actionsByItemId}
          t={t}
        />
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
  actionsByItemId,
  t,
}: {
  page: Page;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  t: TFunc;
}) {
  return (
    <section className="space-y-4">
      <h2 className="border-b pb-2 text-lg font-semibold">{page.title}</h2>
      {page.sections.map((section) => (
        <ReportSection
          key={section.id}
          section={section}
          responses={responses}
          actionsByItemId={actionsByItemId}
          t={t}
        />
      ))}
    </section>
  );
}

function ReportSection({
  section,
  responses,
  actionsByItemId,
  t,
}: {
  section: Section;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  t: TFunc;
}) {
  const visibleItems = section.items.filter((item) => 'prompt' in item) as Item[];
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {section.title}
      </h3>
      <div className="space-y-2">
        {visibleItems.map((item) => (
          <ReportItem
            key={item.id}
            item={item}
            response={responses[item.id]}
            actions={actionsByItemId.get(item.id) ?? []}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function ReportItem({
  item,
  response,
  actions,
  t,
}: {
  item: Item;
  response: unknown;
  actions: ActionSummary[];
  t: TFunc;
}) {
  const prompt = 'prompt' in item ? item.prompt : null;
  if (prompt === null) return null;

  const isMedia = 'type' in item && item.type === 'media';
  const answered = response !== undefined && response !== null && response !== '';
  const hasActions = actions.length > 0;

  return (
    <div className="rounded-md border bg-background text-sm">
      {/* Question + response */}
      <div className="px-3 py-2.5">
        {isMedia ? (
          // Media items: show question prompt then file links below
          <div className="space-y-2">
            <span className="font-medium leading-snug">{prompt}</span>
            {Array.isArray(response) && (response as string[]).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(response as string[]).map((key, i) => {
                  const filename = key.split('/').at(-1) ?? key;
                  const underscoreIdx = filename.indexOf('_');
                  const displayName =
                    underscoreIdx > 0 ? filename.slice(underscoreIdx + 1) : filename;
                  return (
                    <a
                      key={i}
                      href={`/api/files?key=${encodeURIComponent(key)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium hover:bg-accent hover:underline"
                    >
                      📎 {displayName}
                    </a>
                  );
                })}
              </div>
            ) : (
              <span className="italic text-muted-foreground">—</span>
            )}
          </div>
        ) : (
          // Non-media: two-column prompt / value layout
          <div className="grid grid-cols-[1fr_auto] items-start gap-x-4">
            <span className="font-medium leading-snug">{prompt}</span>
            <span
              className={
                answered ? 'text-right font-medium' : 'text-right italic text-muted-foreground'
              }
            >
              {answered ? stringifyResponse(response) : '—'}
            </span>
          </div>
        )}
      </div>

      {/* Inline actions raised from this question */}
      {hasActions ? (
        <div className="border-t bg-amber-50/60 px-3 py-2 dark:bg-amber-950/20">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            {t('actionsRaised', { count: actions.length })}
          </p>
          <div className="space-y-1.5">
            {actions.map((action) => (
              <div
                key={action.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
              >
                <span className="font-medium">
                  {action.referenceNumber !== null ? (
                    <span className="mr-1 text-muted-foreground">#{action.referenceNumber}</span>
                  ) : null}
                  {action.title}
                </span>
                <ActionStatusChip status={action.status} t={t} />
                {action.priority !== null ? (
                  <ActionPriorityChip priority={action.priority} t={t} />
                ) : null}
                {action.assigneeName !== null ? (
                  <span className="text-muted-foreground">→ {action.assigneeName}</span>
                ) : null}
                {action.dueAt !== null ? (
                  <span className="text-muted-foreground">
                    {t('actionDue', {
                      date: new Date(action.dueAt).toLocaleDateString(),
                    })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionStatusChip({
  status,
  t,
}: {
  status: string;
  t: TFunc;
}) {
  const colorMap: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    cancelled: 'bg-muted text-muted-foreground',
  };
  const cls = colorMap[status] ?? colorMap['open'];
  const label = t(`actionStatus.${status as 'open'}`);
  return (
    <span className={`rounded-full px-1.5 py-0.5 font-medium ${cls}`}>{label}</span>
  );
}

function ActionPriorityChip({
  priority,
  t,
}: {
  priority: string;
  t: TFunc;
}) {
  const colorMap: Record<string, string> = {
    low: 'text-slate-500',
    medium: 'text-amber-600',
    high: 'text-orange-600 font-semibold',
    critical: 'text-red-600 font-semibold',
  };
  const cls = colorMap[priority] ?? colorMap['low'];
  return (
    <span className={cls}>{t(`actionPriority.${priority as 'low'}`)}</span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
