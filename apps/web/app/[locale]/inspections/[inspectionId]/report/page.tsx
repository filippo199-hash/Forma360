'use client';

import type { Page, Section, Item, TemplateContent } from '@forma360/shared/template-schema';
import { collectFlaggedAnswers, computeSkippedItemIds } from '@forma360/shared/inspection-eval';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '../../../../../src/components/ui/button';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { ShareLinkDialog } from '../../../../../src/components/share-link-dialog';
import { FocusedPageShell } from '../../../../../src/components/focused-page-shell';
import { trpc } from '../../../../../src/lib/trpc/client';
import { formatDate, formatDateTime } from '../../../../../src/lib/format-date';

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

  // Asset names, to resolve `asset`-question answers ({ assetIds: [...] }).
  // Best-effort: if the viewer lacks `assets.view` the ids simply aren't named.
  const assetsQuery = trpc.assets.list.useQuery({});

  // Branding logo (signed URL) for the report cover. Fetched client-side from
  // the template's branding key so the on-screen report matches the PDF.
  const brandingKey = (
    insp.data?.version.content as
      | { settings?: { branding?: { logoStorageKey?: string } } }
      | undefined
  )?.settings?.branding?.logoStorageKey;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (brandingKey === undefined || brandingKey === '') {
      setLogoUrl(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/upload/template-logo?key=${encodeURIComponent(brandingKey)}`);
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.startsWith('application/json')) {
          const data = (await res.json()) as { url?: string };
          if (!cancelled) setLogoUrl(data.url ?? null);
        } else if (!cancelled) {
          setLogoUrl(`/api/upload/template-logo?key=${encodeURIComponent(brandingKey)}`);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandingKey]);

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

  type ActionRow = NonNullable<typeof actionsQuery.data>['rows'][number];
  const actionsByItemId = new Map<string, ActionRow[]>();
  const allActions: ActionRow[] = actionsQuery.data?.rows ?? [];
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
                time: formatDate(inspection.completedAt),
              })}
            </span>
          ) : null}
          {approvedRow !== undefined ? (
            <span>
              {t('approvedBy', { user: approvedRow.approverName ?? approvedRow.approverUserId })}
            </span>
          ) : null}
        </div>

        {/* ── Actions raised across the inspection ─────────────────────── */}
        {allActions.length > 0 ? (
          <section>
            <h2 className="mb-3 text-base font-semibold">{t('allActionsHeading')}</h2>
            <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
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
                        {action.dueAt !== null ? formatDate(action.dueAt) : '—'}
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
            assets={assetsQuery.data ?? []}
            logoUrl={logoUrl}
            inspectionMeta={{
              documentNumber: inspection.documentNumber,
              startedAt: inspection.startedAt,
              completedAt: inspection.completedAt,
              conductedByName: inspection.conductedByName,
              siteName: inspection.siteName,
            }}
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
  approverName: string | null;
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
  assets,
  logoUrl,
  inspectionMeta,
  t,
}: {
  content: TemplateContent;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  signatures: SigRow[];
  approvals: ApprovalRow[];
  assets: ReadonlyArray<{ id: string; name: string }>;
  logoUrl: string | null;
  inspectionMeta: {
    documentNumber: string | null;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    conductedByName: string | null;
    siteName: string | null;
  };
  t: TFunc;
}) {
  const titlePages = content.pages.filter((p) => p.type === 'title');
  const inspectionPages = content.pages.filter((p) => p.type === 'inspection');
  const branding = content.settings.branding;
  const primary = branding?.primaryColor;
  const accent = branding?.accentColor;

  // Resolve answers stored as IDs (multiple-choice option IDs, and asset IDs
  // from `asset` questions) to their human-readable labels. Without this the
  // report shows raw ULIDs / JSON like {"assetIds":["01KV…"]}.
  const optionLabels = new Map<string, string>();
  for (const set of content.customResponseSets ?? []) {
    for (const opt of set.options) optionLabels.set(opt.id, opt.label);
  }
  for (const a of assets) optionLabels.set(a.id, a.name);

  // Title-page items are auto-populated, not answered — resolve their values
  // from the inspection (site name, conducted-by name, date, document number).
  const fmtDate = (d: Date | string | null): string =>
    d === null ? '' : formatDate(d);
  const titleResponses: Record<string, unknown> = { ...responses };
  for (const page of titlePages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.type === 'site') titleResponses[item.id] = inspectionMeta.siteName ?? '';
        else if (item.type === 'conductedBy')
          titleResponses[item.id] = inspectionMeta.conductedByName ?? '';
        else if (item.type === 'inspectionDate')
          titleResponses[item.id] = fmtDate(inspectionMeta.completedAt ?? inspectionMeta.startedAt);
        else if (item.type === 'documentNumber')
          titleResponses[item.id] = inspectionMeta.documentNumber ?? '';
      }
    }
  }

  // Flagged answers float to the top of the report so an auditor sees the
  // at-risk responses first. Same pure helper the PDF/share report uses.
  const flaggedAnswers = collectFlaggedAnswers(content, responses);
  const flaggedItemIds = new Set(flaggedAnswers.map((f) => f.itemId));
  const skippedItemIds = computeSkippedItemIds(content, responses);
  const noop = new Set<string>();

  return (
    <div className="space-y-8 rounded-lg border bg-card p-6 shadow-sm">
      {/* Branding cover — logo + colours from the template's branding. */}
      {logoUrl !== null || primary !== undefined ? (
        <div
          className="-m-6 mb-2 flex items-center gap-3 rounded-t-lg px-6 py-4 text-white"
          style={
            primary !== undefined ? { backgroundColor: primary } : { backgroundColor: '#0f172a' }
          }
        >
          {logoUrl !== null ? (
            <img src={logoUrl} alt="" className="h-9 w-auto object-contain" />
          ) : null}
          <span className="text-lg font-semibold">{content.title}</span>
        </div>
      ) : null}

      {/* Title page(s) — site, date, conducted-by, location, etc. */}
      {titlePages.map((page) => (
        <ReportPage
          key={page.id}
          page={page}
          responses={titleResponses}
          actionsByItemId={actionsByItemId}
          optionLabels={optionLabels}
          flaggedItemIds={noop}
          skippedItemIds={noop}
          accentColor={accent}
          t={t}
        />
      ))}

      {flaggedAnswers.length > 0 ? (
        <section className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-destructive">
            {t('flaggedHeading', { count: flaggedAnswers.length })}
          </h2>
          <ul className="space-y-1.5">
            {flaggedAnswers.map((f) => (
              <li key={f.itemId} className="text-sm">
                <span className="font-medium">{f.prompt}</span>
                {' — '}
                <span className="font-semibold text-destructive">
                  {f.options.map((o) => o.label).join(', ')}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">
                  · {f.pageTitle} › {f.sectionTitle}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inspectionPages.map((page) => (
        <ReportPage
          key={page.id}
          page={page}
          responses={responses}
          actionsByItemId={actionsByItemId}
          optionLabels={optionLabels}
          flaggedItemIds={flaggedItemIds}
          skippedItemIds={skippedItemIds}
          accentColor={accent}
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
                    {t('signedAt', { time: formatDateTime(sig.signedAt) })}
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
                  {a.approverName ?? a.approverUserId}
                  {a.decidedAt !== null ? (
                    <span className="ml-1 text-muted-foreground">
                      · {formatDateTime(a.decidedAt)}
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
  optionLabels,
  flaggedItemIds,
  skippedItemIds,
  accentColor,
  t,
}: {
  page: Page;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  optionLabels: Map<string, string>;
  flaggedItemIds: Set<string>;
  skippedItemIds: Set<string>;
  accentColor?: string | undefined;
  t: TFunc;
}) {
  return (
    <section className="space-y-4">
      <h2
        className="border-b pb-2 text-lg font-semibold"
        style={accentColor !== undefined ? { borderBottomColor: accentColor } : undefined}
      >
        {page.title}
      </h2>
      {page.sections.map((section) => (
        <ReportSection
          key={section.id}
          section={section}
          responses={responses}
          actionsByItemId={actionsByItemId}
          optionLabels={optionLabels}
          flaggedItemIds={flaggedItemIds}
          skippedItemIds={skippedItemIds}
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
  optionLabels,
  flaggedItemIds,
  skippedItemIds,
  t,
}: {
  section: Section;
  responses: Record<string, unknown>;
  actionsByItemId: Map<string, ActionSummary[]>;
  optionLabels: Map<string, string>;
  flaggedItemIds: Set<string>;
  skippedItemIds: Set<string>;
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
            optionLabels={optionLabels}
            flagged={flaggedItemIds.has(item.id)}
            skipped={skippedItemIds.has(item.id)}
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
  optionLabels,
  flagged,
  skipped,
  t,
}: {
  item: Item;
  response: unknown;
  actions: ActionSummary[];
  optionLabels: Map<string, string>;
  flagged: boolean;
  skipped: boolean;
  t: TFunc;
}) {
  const prompt = 'prompt' in item ? item.prompt : null;
  if (prompt === null) return null;

  // Skipped questions render greyed with a tag and no answer.
  if (skipped) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-sm opacity-60">
        <span className="font-medium leading-snug text-muted-foreground line-through">
          {prompt}
        </span>
        <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t('skippedBadge')}
        </span>
      </div>
    );
  }

  const isMedia = 'type' in item && item.type === 'media';
  const answered = response !== undefined && response !== null && response !== '';
  const hasActions = actions.length > 0;

  const flagBadge = flagged ? (
    <span className="ml-2 inline-flex items-center rounded bg-destructive px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-destructive-foreground">
      {t('flaggedBadge')}
    </span>
  ) : null;

  return (
    <div
      className={
        flagged
          ? 'rounded-md border border-l-4 border-destructive/40 border-l-destructive bg-destructive/5 text-sm'
          : 'rounded-md border bg-background text-sm'
      }
    >
      {/* Question + response */}
      <div className="px-3 py-2.5">
        {isMedia ? (
          // Media items: show question prompt then file links below
          <div className="space-y-2">
            <span className="font-medium leading-snug">
              {prompt}
              {flagBadge}
            </span>
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
            <span className="font-medium leading-snug">
              {prompt}
              {flagBadge}
            </span>
            <span
              className={
                answered ? 'text-right font-medium' : 'text-right italic text-muted-foreground'
              }
            >
              {answered ? formatResponse(response, optionLabels) : '—'}
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
                      date: formatDate(action.dueAt),
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

function ActionStatusChip({ status, t }: { status: string; t: TFunc }) {
  const colorMap: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    cancelled: 'bg-muted text-muted-foreground',
  };
  const cls = colorMap[status] ?? colorMap['open'];
  const label = t(`actionStatus.${status as 'open'}`);
  return <span className={`rounded-full px-1.5 py-0.5 font-medium ${cls}`}>{label}</span>;
}

function ActionPriorityChip({ priority, t }: { priority: string; t: TFunc }) {
  const colorMap: Record<string, string> = {
    low: 'text-slate-500',
    medium: 'text-amber-600',
    high: 'text-orange-600 font-semibold',
    critical: 'text-red-600 font-semibold',
  };
  const cls = colorMap[priority] ?? colorMap['low'];
  return <span className={cls}>{t(`actionPriority.${priority as 'low'}`)}</span>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Render a stored response as readable text. Multiple-choice answers are
 * stored as response-option IDs (sometimes as a JSON-encoded array string);
 * resolve those to their labels via {@link optionLabels} so the report shows
 * "Pass, Fail" rather than `["01KV…","01KV…"]`.
 */
function formatResponse(v: unknown, optionLabels: Map<string, string>): string {
  if (v === null || v === undefined) return '';

  // A value stored as a JSON-encoded array string, e.g. '["id1","id2"]'.
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return formatResponse(parsed, optionLabels);
      } catch {
        // not JSON — fall through and treat as a plain string
      }
    }
    return optionLabels.get(v) ?? v;
  }

  if (typeof v === 'number' || typeof v === 'boolean') return String(v);

  if (Array.isArray(v)) {
    return (v as unknown[])
      .map((item) => {
        if (typeof item === 'string') return optionLabels.get(item) ?? item;
        if (item !== null && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj['label'] === 'string') return obj['label'];
          if (typeof obj['value'] === 'string') return obj['value'];
        }
        return String(item);
      })
      .filter((s) => s.length > 0)
      .join(', ');
  }

  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj['label'] === 'string') return obj['label'];
    // Asset / site / user / group multi-select answers wrap an id array,
    // e.g. { assetIds: ["01KV…", …] }. Unwrap and resolve to labels.
    for (const key of ['assetIds', 'siteIds', 'userIds', 'groupIds'] as const) {
      if (Array.isArray(obj[key])) return formatResponse(obj[key], optionLabels);
    }
    if ('value' in obj) return String(obj['value']);
  }

  try {
    return JSON.stringify(v);
  } catch {
    return '[unserialisable]';
  }
}
