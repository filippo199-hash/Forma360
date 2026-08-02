'use client';

/**
 * Substance detail — the living record: where it's kept, the current
 * safety data sheet (versioned, with the review-age prompt), its
 * assessments, exposure monitoring vs WELs, substitution status and the
 * audit trail.
 *
 * The page leads with what needs doing: storage incompatibility
 * warnings, the SDS review prompt, and — for carcinogens / mutagens —
 * the substitution-first banner that publishing an assessment will
 * enforce (CO-E19).
 */
import { AlertTriangle, FileText, Plus, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SdsExtraction } from '@forma360/shared/coshh';
import {
  AssessmentStatusChip,
  PictogramChips,
  RegimeChips,
  SdsStatusChip,
} from '../../../../src/components/coshh/chips';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const UNIT_OPTIONS = ['ml', 'l', 'g', 'kg', 'units'] as const;
const STORAGE_CLASS_OPTIONS = [
  'flammable',
  'oxidiser',
  'corrosive_acid',
  'corrosive_base',
  'toxic',
  'compressed_gas',
  'water_reactive',
  'general',
] as const;
const SUBSTITUTION_OPTIONS = [
  'not_assessed',
  'considered_rejected',
  'planned',
  'substituted',
] as const;

function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (d == null) return '—';
  return new Date(d).toLocaleDateString(locale, { dateStyle: 'medium' });
}

export default function CoshhSubstanceDetailPage() {
  const t = useTranslations('coshh');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ substanceId: string }>();
  const substanceId = params.substanceId;
  const canManage = useHasPermission('coshh.manage');
  const canCreate = useHasPermission('coshh.create');

  const utils = trpc.useUtils();
  const query = trpc.coshh.substances.get.useQuery({ substanceId });

  const refresh = (): void => {
    void utils.coshh.substances.get.invalidate({ substanceId });
    void utils.coshh.substances.list.invalidate();
    void utils.coshh.overview.invalidate();
  };
  const onError = () => toast.error(t('saveError'));

  const addLocation = trpc.coshh.locations.add.useMutation({ onSuccess: refresh, onError });
  const removeLocation = trpc.coshh.locations.remove.useMutation({ onSuccess: refresh, onError });
  const attachSds = trpc.coshh.sds.attach.useMutation({ onSuccess: refresh, onError });
  const confirmCurrent = trpc.coshh.sds.confirmCurrent.useMutation({
    onSuccess: () => {
      toast.success(t('sds.confirmedToast'));
      refresh();
    },
    onError,
  });
  const updateSubstance = trpc.coshh.substances.update.useMutation({
    onSuccess: refresh,
    onError,
  });
  const setSubstitution = trpc.coshh.substances.setSubstitution.useMutation({
    onSuccess: () => {
      toast.success(t('substitution.savedToast'));
      refresh();
    },
    onError,
  });
  const archive = trpc.coshh.substances.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      refresh();
    },
    onError,
  });
  const createAssessment = trpc.coshh.assessments.create.useMutation();
  const recordMonitoring = trpc.coshh.monitoring.record.useMutation();

  // Add-location row state
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [locSiteId, setLocSiteId] = useState('');
  const [locText, setLocText] = useState('');
  const [locQty, setLocQty] = useState('');
  const [locUnit, setLocUnit] = useState('');
  const [locClass, setLocClass] = useState('');

  // SDS upload state
  const sdsInputRef = useRef<HTMLInputElement | null>(null);
  const [sdsUploading, setSdsUploading] = useState(false);
  const [applyExtraction, setApplyExtraction] = useState(true);

  // Dialogs
  const [assessmentDialogOpen, setAssessmentDialogOpen] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');
  const [monitoringDialogOpen, setMonitoringDialogOpen] = useState(false);
  const [monAgent, setMonAgent] = useState('');
  const [monDate, setMonDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [monType, setMonType] = useState('personal');
  const [monPeriod, setMonPeriod] = useState('twa8h');
  const [monValue, setMonValue] = useState('');
  const [monUnit, setMonUnit] = useState('mg/m3');
  const [substitutionOpen, setSubstitutionOpen] = useState(false);
  const [subStatus, setSubStatus] = useState('');
  const [subNotes, setSubNotes] = useState('');

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-muted-foreground">
        {t('notFound')}
      </div>
    );
  }

  const {
    substance,
    locations,
    sdsDocuments,
    sdsStatus,
    assessments,
    monitoring,
    events,
    storageConflicts,
    substitutionPriority,
  } = query.data;
  const archived = substance.archivedAt !== null;
  const substitutionUnresolved =
    substitutionPriority !== 'standard' && substance.substitutionStatus === 'not_assessed';

  async function handleSdsUpload(file: File | null) {
    if (file === null || file.type !== 'application/pdf') return;
    setSdsUploading(true);
    try {
      const blobForm = new FormData();
      blobForm.set('entityId', substanceId);
      blobForm.set('file', file);
      const aiForm = new FormData();
      aiForm.set('file', file);
      const [blobRes, aiRes] = await Promise.all([
        fetch('/api/upload/coshh-doc', { method: 'POST', body: blobForm }),
        fetch('/api/ai/coshh-sds-import', { method: 'POST', body: aiForm }),
      ]);
      if (!blobRes.ok) {
        toast.error(t('sds.uploadError'));
        return;
      }
      const blob = (await blobRes.json()) as {
        storageKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      };
      let extraction: SdsExtraction | null = null;
      if (aiRes.ok) {
        extraction = ((await aiRes.json()) as { extraction: SdsExtraction }).extraction;
      }
      await attachSds.mutateAsync({
        substanceId,
        ...blob,
        issueDate: extraction?.issueDate != null ? new Date(extraction.issueDate) : null,
        ...(extraction !== null ? { extraction } : {}),
      });
      // Optionally refresh the hazard profile from the new sheet — a new
      // SDS revision is exactly when classification changes arrive.
      if (extraction !== null && applyExtraction) {
        await updateSubstance.mutateAsync({
          substanceId,
          hazardClassification: extraction.hazardClassification,
          hStatements: extraction.hStatements,
          pStatements: extraction.pStatements,
          pictograms: extraction.pictograms,
          workplaceExposureLimits: extraction.workplaceExposureLimits,
          signalWord: extraction.signalWord,
        });
        toast.success(t('sds.attachedAppliedToast'));
      } else {
        toast.success(t('sds.attachedToast'));
      }
    } finally {
      setSdsUploading(false);
      if (sdsInputRef.current !== null) sdsInputRef.current.value = '';
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/${locale}/coshh`} className="text-sm text-muted-foreground hover:underline">
            ← {t('backToList')}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {substance.name}
            {substance.signalWord !== null ? (
              <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
                {t(`signalWords.${substance.signalWord}` as never)}
              </span>
            ) : null}
            {archived ? <AssessmentStatusChip status="archived" /> : null}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {substance.referenceNumber}
            {substance.supplier !== '' ? ` · ${substance.supplier}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PictogramChips codes={substance.pictograms} />
            <RegimeChips flags={substance} />
          </div>
        </div>
        {canManage && !archived ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (window.confirm(t('archiveConfirm'))) {
                archive.mutate({ substanceId });
              }
            }}
          >
            {t('archiveButton')}
          </Button>
        ) : null}
      </div>

      {/* ── Needs-attention banners ─────────────────────────────────── */}
      {substitutionUnresolved ? (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {substitutionPriority === 'required'
                ? t('substitution.requiredBanner')
                : t('substitution.advisedBanner')}
            </p>
            <p className="mt-0.5 text-xs opacity-90">{t('substitution.bannerHint')}</p>
          </div>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setSubstitutionOpen(true)}>
              {t('substitution.recordButton')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {storageConflicts.map((c) => (
        <div
          key={`${c.siteId}-${c.otherSubstanceId}`}
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0">
            {t('storageConflictBanner', {
              site: c.siteName ?? '—',
              other: c.otherSubstanceName,
              mine: t(`storageClasses.${c.myStorageClass}` as never),
              theirs: t(`storageClasses.${c.otherStorageClass}` as never),
            })}{' '}
            <Link href={`/${locale}/coshh/${c.otherSubstanceId}`} className="underline">
              {t('viewOther')}
            </Link>
          </p>
        </div>
      ))}
      {sdsStatus !== 'current' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <FileText className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {sdsStatus === 'missing' ? t('sds.missingBanner') : t('sds.dueBanner')}
          </p>
          {canManage ? (
            <div className="flex gap-2">
              {sdsStatus === 'review_due' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={confirmCurrent.isPending}
                  onClick={() => confirmCurrent.mutate({ substanceId })}
                >
                  {t('sds.confirmButton')}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={sdsUploading}
                onClick={() => sdsInputRef.current?.click()}
              >
                <UploadCloud className="mr-1 h-3.5 w-3.5" />
                {sdsUploading ? t('sds.uploading') : t('sds.uploadButton')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Assessments ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('assessments.sectionTitle')}</h2>
            {canCreate && !archived ? (
              <Button size="sm" onClick={() => setAssessmentDialogOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('assessments.newButton')}
              </Button>
            ) : null}
          </div>
          {assessments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('assessments.empty')}</p>
          ) : (
            <ul className="divide-y">
              {assessments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/${locale}/coshh/${substanceId}/assessments/${a.id}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-muted/30"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {a.referenceNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {a.taskDescription}
                    </span>
                    {a.reviewDue ? (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                        {t('reviewDue')}
                      </span>
                    ) : null}
                    <AssessmentStatusChip status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Locations / inventory ───────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('locations.sectionTitle')}</h2>
            {canManage && !archived ? (
              <Button size="sm" variant="outline" onClick={() => setShowAddLocation((v) => !v)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('locations.addButton')}
              </Button>
            ) : null}
          </div>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('locations.empty')}</p>
          ) : (
            <ul className="divide-y text-sm">
              {locations.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{l.siteName ?? t('locations.noSite')}</span>
                    {l.locationText !== '' ? (
                      <span className="text-muted-foreground"> · {l.locationText}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {l.quantity !== null ? `${l.quantity} ${l.unit ?? ''}` : '—'}
                  </span>
                  {l.storageClass !== null ? (
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {t(`storageClasses.${l.storageClass}` as never)}
                    </span>
                  ) : null}
                  {canManage && !archived ? (
                    <button
                      type="button"
                      aria-label={t('locations.removeAction')}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeLocation.mutate({ locationId: l.id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {showAddLocation ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <SiteSelector
                  value={locSiteId !== '' ? [locSiteId] : []}
                  onChange={(next) => setLocSiteId(next[0] ?? '')}
                  multiple={false}
                />
                <Input
                  value={locText}
                  onChange={(e) => setLocText(e.target.value)}
                  placeholder={t('create.wherePlaceholder')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={locQty}
                  onChange={(e) => setLocQty(e.target.value)}
                  placeholder={t('create.quantityLabel')}
                  className="w-28"
                />
                <select
                  aria-label={t('create.unitLabel')}
                  value={locUnit}
                  onChange={(e) => setLocUnit(e.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="">—</option>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('create.storageClassLabel')}
                  value={locClass}
                  onChange={(e) => setLocClass(e.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="">{t('create.storageClassLabel')}</option>
                  {STORAGE_CLASS_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(`storageClasses.${c}` as never)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={addLocation.isPending}
                  onClick={() => {
                    addLocation.mutate({
                      substanceId,
                      ...(locSiteId !== '' ? { siteId: locSiteId } : {}),
                      locationText: locText.trim(),
                      quantity: locQty !== '' && Number(locQty) > 0 ? Number(locQty) : null,
                      unit: locUnit !== '' ? (locUnit as never) : null,
                      storageClass: locClass !== '' ? (locClass as never) : null,
                      storageNotes: '',
                    });
                    setShowAddLocation(false);
                    setLocSiteId('');
                    setLocText('');
                    setLocQty('');
                    setLocUnit('');
                    setLocClass('');
                  }}
                >
                  {t('locations.saveButton')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Safety data sheets ──────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {t('sds.sectionTitle')}
              <SdsStatusChip status={sdsStatus} />
            </h2>
            {canManage && !archived ? (
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={applyExtraction}
                    onChange={(e) => setApplyExtraction(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <Sparkles className="h-3 w-3" />
                  {t('sds.applyExtractionLabel')}
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sdsUploading}
                  onClick={() => sdsInputRef.current?.click()}
                >
                  <UploadCloud className="mr-1 h-3.5 w-3.5" />
                  {sdsUploading ? t('sds.uploading') : t('sds.uploadButton')}
                </Button>
              </div>
            ) : null}
          </div>
          <input
            ref={sdsInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => void handleSdsUpload(e.target.files?.[0] ?? null)}
          />
          {sdsDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sds.empty')}</p>
          ) : (
            <ul className="divide-y text-sm">
              {sdsDocuments.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <a
                      href={`/api/files?key=${encodeURIComponent(d.storageKey)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {d.filename}
                    </a>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {`v${d.version}`}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('sds.issued', { date: formatDate(d.issueDate, locale) })}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('sds.reviewBy', { date: formatDate(d.reviewByDate, locale) })}
                  </span>
                  {d.isCurrent ? (
                    <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100">
                      {t('sds.currentChip')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Hazard profile ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">{t('hazardProfile.sectionTitle')}</h2>
          {substance.hazardClassification.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {substance.hazardClassification.join(' · ')}
            </p>
          ) : null}
          {substance.hStatements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hazardProfile.empty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {substance.hStatements.map((h) => (
                <li key={h.code} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{h.code}</span>
                  <span className="min-w-0">{h.text}</span>
                </li>
              ))}
            </ul>
          )}
          {substance.workplaceExposureLimits.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{t('wel.agent')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('wel.twa')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('wel.stel')}</th>
                    <th className="py-1.5 font-medium">{t('wel.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {substance.workplaceExposureLimits.map((w, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{w.agent}</td>
                      <td className="py-1.5 pr-3">
                        {w.twa8h !== null ? `${w.twa8h.value} ${w.twa8h.unit}` : '—'}
                      </td>
                      <td className="py-1.5 pr-3">
                        {w.stel15min !== null ? `${w.stel15min.value} ${w.stel15min.unit}` : '—'}
                      </td>
                      <td className="py-1.5 text-muted-foreground">{w.source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {t('substitution.statusLine', {
                status: t(`substitution.status.${substance.substitutionStatus}` as never),
              })}
              {substance.substitutionNotes !== '' ? ` — ${substance.substitutionNotes}` : ''}
            </p>
            {canManage && !archived ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0 text-primary"
                onClick={() => {
                  setSubStatus(substance.substitutionStatus);
                  setSubNotes(substance.substitutionNotes);
                  setSubstitutionOpen(true);
                }}
              >
                {t('substitution.recordButton')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Exposure monitoring ─────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('monitoring.sectionTitle')}</h2>
            {canManage && !archived ? (
              <Button size="sm" variant="outline" onClick={() => setMonitoringDialogOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('monitoring.recordButton')}
              </Button>
            ) : null}
          </div>
          {monitoring.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('monitoring.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{t('monitoring.date')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('wel.agent')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('monitoring.type')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('monitoring.period')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('monitoring.result')}</th>
                    <th className="py-1.5 font-medium">{t('monitoring.vsWel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {monitoring.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{formatDate(m.sampledAt, locale)}</td>
                      <td className="py-1.5 pr-3">{m.agent}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {t(`monitoring.types.${m.sampleType}` as never)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {t(`monitoring.periods.${m.period}` as never)}
                      </td>
                      <td className="py-1.5 pr-3">
                        {m.resultValue} {m.resultUnit}
                      </td>
                      <td className="py-1.5">
                        {m.exceedsWel === null ? (
                          <span className="text-xs text-muted-foreground">
                            {t('monitoring.notComparable')}
                          </span>
                        ) : m.exceedsWel ? (
                          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                            {t('monitoring.exceeds')}
                          </span>
                        ) : (
                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100">
                            {t('monitoring.withinLimit')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Activity ────────────────────────────────────────────────── */}
      {events.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-sm font-semibold">{t('activity.sectionTitle')}</h2>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {events.slice(0, 20).map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="shrink-0">{formatDate(e.createdAt, locale)}</span>
                  <span className="min-w-0">
                    {t(`activity.kinds.${e.kind}` as never)}
                    {e.detail !== '' ? ` — ${e.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── New assessment dialog ───────────────────────────────────── */}
      <Dialog open={assessmentDialogOpen} onOpenChange={setAssessmentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assessments.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="task">{t('assessments.taskLabel')}</Label>
            <Textarea
              id="task"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              rows={3}
              placeholder={t('assessments.taskPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('assessments.taskHint')}</p>
          </div>
          <DialogFooter>
            <Button
              disabled={taskDescription.trim().length === 0 || createAssessment.isPending}
              onClick={async () => {
                try {
                  const res = await createAssessment.mutateAsync({
                    substanceId,
                    taskDescription: taskDescription.trim(),
                  });
                  setAssessmentDialogOpen(false);
                  router.push(`/${locale}/coshh/${substanceId}/assessments/${res.assessmentId}`);
                } catch {
                  toast.error(t('saveError'));
                }
              }}
            >
              {t('assessments.createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record monitoring dialog ────────────────────────────────── */}
      <Dialog open={monitoringDialogOpen} onOpenChange={setMonitoringDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('monitoring.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mon-agent">{t('wel.agent')}</Label>
              <Input
                id="mon-agent"
                value={monAgent}
                onChange={(e) => setMonAgent(e.target.value)}
                list="coshh-wel-agents"
              />
              <datalist id="coshh-wel-agents">
                {substance.workplaceExposureLimits.map((w, i) => (
                  <option key={i} value={w.agent} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mon-date">{t('monitoring.date')}</Label>
              <Input
                id="mon-date"
                type="date"
                value={monDate}
                onChange={(e) => setMonDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mon-type">{t('monitoring.type')}</Label>
              <select
                id="mon-type"
                value={monType}
                onChange={(e) => setMonType(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['personal', 'static', 'biological'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`monitoring.types.${s}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mon-period">{t('monitoring.period')}</Label>
              <select
                id="mon-period"
                value={monPeriod}
                onChange={(e) => setMonPeriod(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="twa8h">{t('monitoring.periods.twa8h')}</option>
                <option value="stel15min">{t('monitoring.periods.stel15min')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mon-value">{t('monitoring.result')}</Label>
              <Input
                id="mon-value"
                type="number"
                min="0"
                step="any"
                value={monValue}
                onChange={(e) => setMonValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mon-unit">{t('monitoring.unit')}</Label>
              <select
                id="mon-unit"
                value={monUnit}
                onChange={(e) => setMonUnit(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(['mg/m3', 'ppm', 'fibres/ml'] as const).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={monAgent.trim() === '' || monValue === '' || recordMonitoring.isPending}
              onClick={async () => {
                try {
                  const res = await recordMonitoring.mutateAsync({
                    substanceId,
                    agent: monAgent.trim(),
                    sampledAt: new Date(monDate),
                    sampleType: monType as never,
                    period: monPeriod as never,
                    resultValue: Number(monValue),
                    resultUnit: monUnit as never,
                  });
                  setMonitoringDialogOpen(false);
                  setMonAgent('');
                  setMonValue('');
                  if (res.exceedsWel === true) toast.warning(t('monitoring.exceedsToast'));
                  else if (res.exceedsWel === null) toast.info(t('monitoring.notComparableToast'));
                  else toast.success(t('monitoring.recordedToast'));
                  refresh();
                } catch {
                  toast.error(t('saveError'));
                }
              }}
            >
              {t('monitoring.saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Substitution dialog ─────────────────────────────────────── */}
      <Dialog open={substitutionOpen} onOpenChange={setSubstitutionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('substitution.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('substitution.dialogHint')}</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-status">{t('substitution.statusLabel')}</Label>
              <select
                id="sub-status"
                value={subStatus === '' ? substance.substitutionStatus : subStatus}
                onChange={(e) => setSubStatus(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {SUBSTITUTION_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`substitution.status.${s}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-notes">{t('substitution.notesLabel')}</Label>
              <Textarea
                id="sub-notes"
                value={subNotes}
                onChange={(e) => setSubNotes(e.target.value)}
                rows={3}
                placeholder={t('substitution.notesPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={setSubstitution.isPending}
              onClick={() => {
                setSubstitution.mutate({
                  substanceId,
                  status: (subStatus === '' ? substance.substitutionStatus : subStatus) as never,
                  notes: subNotes,
                });
                setSubstitutionOpen(false);
              }}
            >
              {t('substitution.saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
