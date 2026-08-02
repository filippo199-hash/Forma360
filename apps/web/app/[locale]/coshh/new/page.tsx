'use client';

/**
 * Add substance — the minimal-typing flow.
 *
 * The practitioner (or whoever receives the delivery) drops the safety
 * data sheet PDF; Claude reads it and pre-fills everything — name,
 * supplier, physical form, GHS classification, H/P statements,
 * pictograms, WELs, storage guidance, issue date. The human's job is to
 * check the pre-fill against the sheet, say where it's kept, and hit
 * create. A manual path exists for the no-PDF case.
 *
 * Special-regime flags (carcinogen / mutagen / asthmagen) are inferred
 * from the H statements and shown before saving so nobody is surprised
 * by the substitution-first behaviour later. Duplicate names are caught
 * by the router (CO-E10) and surfaced as a "already in your inventory —
 * add a location instead?" prompt rather than a dead error.
 */
import {
  DEFAULT_SDS_REVIEW_MONTHS,
  inferRegimeFlags,
  suggestStorageClass,
  type SdsExtraction,
} from '@forma360/shared/coshh';
import { FileText, Sparkles, UploadCloud, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PictogramChips, RegimeChips } from '../../../../src/components/coshh/chips';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';

const PHYSICAL_FORM_OPTIONS = [
  'liquid',
  'solid',
  'powder',
  'gas',
  'aerosol',
  'fume',
  'mist',
  'fibre',
  'other',
] as const;
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

interface UploadedSds {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function generateStagingId(): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 26; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export default function NewCoshhSubstancePage() {
  const t = useTranslations('coshh.create');
  const tCoshh = useTranslations('coshh');
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [phase, setPhase] = useState<'pick' | 'reading' | 'form'>('pick');
  const [extraction, setExtraction] = useState<SdsExtraction | null>(null);
  const [sdsFile, setSdsFile] = useState<UploadedSds | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Substance fields
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [productIdentifier, setProductIdentifier] = useState('');
  const [physicalForm, setPhysicalForm] = useState('');
  const [usageDescription, setUsageDescription] = useState('');
  const [isBiologicalAgent, setIsBiologicalAgent] = useState(false);
  const [containsLead, setContainsLead] = useState(false);
  const [asbestosReferral, setAsbestosReferral] = useState(false);

  // Initial location
  const [siteId, setSiteId] = useState('');
  const [locationText, setLocationText] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [storageClass, setStorageClass] = useState('');
  const [storageNotes, setStorageNotes] = useState('');

  const [duplicateOf, setDuplicateOf] = useState(false);

  const createSubstance = trpc.coshh.substances.create.useMutation();

  // Live duplicate hint while typing (server still enforces).
  const { data: existing } = trpc.coshh.substances.list.useQuery(
    { status: 'all', search: name.trim() },
    { enabled: name.trim().length > 2 },
  );
  const nameTaken = useMemo(
    () =>
      (existing ?? []).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) ??
      null,
    [existing, name],
  );

  const regimePreview = useMemo(() => {
    const inferred = inferRegimeFlags((extraction?.hStatements ?? []).map((h) => h.code));
    return {
      isCarcinogen: inferred.carcinogen,
      isMutagen: inferred.mutagen,
      isAsthmagen: inferred.asthmagen,
      isBiologicalAgent,
      containsLead,
      asbestosReferral,
    };
  }, [extraction, isBiologicalAgent, containsLead, asbestosReferral]);

  async function handleSdsFile(file: File | null) {
    if (file === null) return;
    if (file.type !== 'application/pdf') {
      toast.error(t('pdfOnly'));
      return;
    }
    setPhase('reading');
    try {
      // Blob upload and AI read run in parallel — the storage key is
      // needed for the create call, the extraction for the pre-fill.
      const blobForm = new FormData();
      blobForm.set('entityId', generateStagingId());
      blobForm.set('file', file);
      const aiForm = new FormData();
      aiForm.set('file', file);
      const [blobRes, aiRes] = await Promise.all([
        fetch('/api/upload/coshh-doc', { method: 'POST', body: blobForm }),
        fetch('/api/ai/coshh-sds-import', { method: 'POST', body: aiForm }),
      ]);
      if (!blobRes.ok) {
        toast.error(t('uploadError'));
        setPhase('pick');
        return;
      }
      setSdsFile((await blobRes.json()) as UploadedSds);

      if (aiRes.ok) {
        const { extraction: ex } = (await aiRes.json()) as { extraction: SdsExtraction };
        setExtraction(ex);
        setName(ex.productName);
        setSupplier(ex.supplier);
        setProductIdentifier(ex.productIdentifier);
        if (ex.physicalForm !== null) setPhysicalForm(ex.physicalForm);
        setStorageNotes(ex.storageRequirements);
        const suggested = suggestStorageClass(ex.pictograms);
        if (suggested !== null) setStorageClass(suggested);
        if (ex.confidence === 'low') toast.warning(t('lowConfidence'));
        else toast.success(t('readToast'));
      } else {
        // Extraction failed but the file is stored — fall through to the
        // manual form with the SDS attached so nothing is lost.
        toast.warning(t('extractionFailed'));
      }
      setPhase('form');
    } catch {
      toast.error(t('uploadError'));
      setPhase('pick');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0 || createSubstance.isPending) return;
    const input: Parameters<typeof createSubstance.mutateAsync>[0] = {
      name: name.trim(),
      supplier: supplier.trim(),
      productIdentifier: productIdentifier.trim(),
      usageDescription: usageDescription.trim(),
      isBiologicalAgent,
      containsLead,
      asbestosReferral,
      allowDuplicate: duplicateOf,
      hazardClassification: extraction?.hazardClassification ?? [],
      hStatements: extraction?.hStatements ?? [],
      pStatements: extraction?.pStatements ?? [],
      pictograms: extraction?.pictograms ?? [],
      workplaceExposureLimits: extraction?.workplaceExposureLimits ?? [],
      sdsReviewMonths: DEFAULT_SDS_REVIEW_MONTHS,
    };
    if (physicalForm !== '') input.physicalForm = physicalForm as never;
    if (extraction?.signalWord != null) input.signalWord = extraction.signalWord;
    if (sdsFile !== null) {
      input.initialSds = {
        ...sdsFile,
        issueDate: extraction?.issueDate != null ? new Date(extraction.issueDate) : null,
        ...(extraction !== null ? { extraction } : {}),
      };
    }
    const hasLocation =
      siteId !== '' || locationText.trim() !== '' || quantity !== '' || storageClass !== '';
    if (hasLocation) {
      input.initialLocation = {
        ...(siteId !== '' ? { siteId } : {}),
        locationText: locationText.trim(),
        quantity: quantity !== '' && Number(quantity) > 0 ? Number(quantity) : null,
        unit: unit !== '' ? (unit as never) : null,
        storageClass: storageClass !== '' ? (storageClass as never) : null,
        storageNotes: storageNotes.trim(),
      };
    }
    try {
      const result = await createSubstance.mutateAsync(input);
      toast.success(t('successToast', { ref: result.referenceNumber }));
      router.push(`/${locale}/coshh/${result.substanceId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'duplicate-name') {
        setDuplicateOf(true);
        toast.warning(t('duplicateWarning'));
      } else {
        toast.error(t('errorToast'));
      }
    }
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/coshh`} width="wide">
      {phase === 'pick' ? (
        <Card className="mx-auto max-w-2xl">
          <CardContent className="space-y-5 p-6">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void handleSdsFile(e.dataTransfer.files[0] ?? null);
              }}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/30'
              }`}
            >
              <UploadCloud className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">{t('dropTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('dropHint')}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('aiBadge')}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => void handleSdsFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setPhase('form')}
              >
                {t('manualLink')}
              </button>
            </div>
          </CardContent>
        </Card>
      ) : phase === 'reading' ? (
        <Card className="mx-auto max-w-2xl">
          <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
            <Sparkles className="h-8 w-8 animate-pulse text-primary" />
            <div>
              <p className="font-medium">{t('readingTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('readingHint')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
          {extraction !== null ? (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>{t('aiPrefilledBanner')}</p>
            </div>
          ) : null}
          {sdsFile !== null ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{sdsFile.filename}</span>
              <button
                type="button"
                aria-label={t('removeSds')}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setSdsFile(null);
                  setExtraction(null);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-sm font-semibold">{t('identitySection')}</h2>
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  {t('nameLabel')}
                  <span className="ml-1 text-destructive">*</span>
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                {nameTaken !== null && !duplicateOf ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('alreadyInInventory')}{' '}
                    <Link href={`/${locale}/coshh/${nameTaken.id}`} className="underline">
                      {t('openExisting', { ref: nameTaken.referenceNumber ?? '' })}
                    </Link>
                  </p>
                ) : null}
                {duplicateOf ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('duplicateConfirmHint')}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="supplier">{t('supplierLabel')}</Label>
                  <Input
                    id="supplier"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="productIdentifier">{t('identifierLabel')}</Label>
                  <Input
                    id="productIdentifier"
                    value={productIdentifier}
                    onChange={(e) => setProductIdentifier(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="physicalForm">{t('formLabel')}</Label>
                  <select
                    id="physicalForm"
                    value={physicalForm}
                    onChange={(e) => setPhysicalForm(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {PHYSICAL_FORM_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {tCoshh(`physicalForms.${f}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usage">{t('usageLabel')}</Label>
                  <Input
                    id="usage"
                    value={usageDescription}
                    onChange={(e) => setUsageDescription(e.target.value)}
                    placeholder={t('usagePlaceholder')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="text-sm font-semibold">{t('hazardSection')}</h2>
              {extraction !== null ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {extraction.signalWord !== null ? (
                      <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
                        {tCoshh(`signalWords.${extraction.signalWord}` as never)}
                      </span>
                    ) : null}
                    <PictogramChips codes={extraction.pictograms} />
                  </div>
                  {extraction.hazardClassification.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {extraction.hazardClassification.join(' · ')}
                    </p>
                  ) : null}
                  {extraction.hStatements.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                      {extraction.hStatements.map((h) => (
                        <li key={h.code} className="flex gap-2">
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {h.code}
                          </span>
                          <span className="min-w-0">{h.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('noHazardsRead')}</p>
                  )}
                  {extraction.workplaceExposureLimits.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('welCount', { count: extraction.workplaceExposureLimits.length })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('hazardManualHint')}</p>
              )}
              <div className="space-y-2 border-t pt-3">
                <RegimeChips flags={regimePreview} />
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isBiologicalAgent}
                      onChange={(e) => setIsBiologicalAgent(e.target.checked)}
                      className="h-4 w-4"
                    />
                    {tCoshh('regimes.biological')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={containsLead}
                      onChange={(e) => setContainsLead(e.target.checked)}
                      className="h-4 w-4"
                    />
                    {tCoshh('regimes.lead')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={asbestosReferral}
                      onChange={(e) => setAsbestosReferral(e.target.checked)}
                      className="h-4 w-4"
                    />
                    {tCoshh('regimes.asbestos')}
                  </label>
                </div>
                {regimePreview.asbestosReferral ? (
                  <p className="text-xs text-muted-foreground">{t('asbestosHint')}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-sm font-semibold">{t('locationSection')}</h2>
              <div className="space-y-1.5">
                <Label htmlFor="site">{placeLabel}</Label>
                <SiteSelector
                  value={siteId !== '' ? [siteId] : []}
                  onChange={(next) => setSiteId(next[0] ?? '')}
                  multiple={false}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="locationText">{t('whereLabel')}</Label>
                  <Input
                    id="locationText"
                    value={locationText}
                    onChange={(e) => setLocationText(e.target.value)}
                    placeholder={t('wherePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">{t('quantityLabel')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="quantity"
                      type="number"
                      min="0"
                      step="any"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="min-w-0"
                    />
                    <select
                      aria-label={t('unitLabel')}
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="storageClass">{t('storageClassLabel')}</Label>
                  <select
                    id="storageClass"
                    value={storageClass}
                    onChange={(e) => setStorageClass(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {STORAGE_CLASS_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {tCoshh(`storageClasses.${c}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="storageNotes">{t('storageNotesLabel')}</Label>
                <Textarea
                  id="storageNotes"
                  value={storageNotes}
                  onChange={(e) => setStorageNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={name.trim().length === 0 || createSubstance.isPending}>
              {createSubstance.isPending
                ? t('submitting')
                : duplicateOf
                  ? t('submitAnyway')
                  : t('submit')}
            </Button>
          </div>
        </form>
      )}
    </FocusedPageShell>
  );
}
