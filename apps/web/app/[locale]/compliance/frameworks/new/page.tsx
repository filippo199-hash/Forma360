'use client';

import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { cn } from '../../../../../src/lib/cn';
import { trpc } from '../../../../../src/lib/trpc/client';

const FRAMEWORK_TYPES = [
  'health_safety',
  'quality',
  'environmental',
  'regulatory',
  'custom',
] as const;

type FrameworkType = (typeof FRAMEWORK_TYPES)[number];

type Step =
  | { id: 'type' }
  | { id: 'standard'; type: FrameworkType }
  | { id: 'confirm'; type: FrameworkType; catalogueId: string | null };

export default function NewFrameworkPage() {
  const t = useTranslations('compliance.frameworks.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [step, setStep] = useState<Step>({ id: 'type' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  // Scope state
  const [scopeMode, setScopeMode] = useState<'company' | 'sites'>('company');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [jurisdiction, setJurisdiction] = useState('');

  const { data: sitesData } = trpc.sites.list.useQuery(undefined, {
    enabled: step.id === 'confirm',
  });
  const sites = sitesData ?? [];

  // Fetch catalogue entries for the selected type (only when on step 'standard').
  const selectedType = step.id !== 'type' ? step.type : null;
  const { data: catalogueEntries } = trpc.compliance.catalogue.list.useQuery(
    { type: selectedType ?? 'custom' },
    { enabled: step.id === 'standard' && selectedType !== 'custom' },
  );

  // Fetch the full catalogue entry (with rules) when a standard is selected.
  const selectedCatalogueId =
    step.id === 'confirm' && step.catalogueId !== null ? step.catalogueId : null;
  const { data: catalogueEntry } = trpc.compliance.catalogue.get.useQuery(
    { catalogueId: selectedCatalogueId ?? '' },
    { enabled: selectedCatalogueId !== null },
  );

  const create = trpc.compliance.frameworks.create.useMutation({
    onSuccess: ({ frameworkId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/compliance/frameworks/${frameworkId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleTypeSelect(type: FrameworkType) {
    if (type === 'custom') {
      setStep({ id: 'confirm', type: 'custom', catalogueId: null });
    } else {
      setStep({ id: 'standard', type });
    }
  }

  function handleStandardSelect(catalogueId: string) {
    const entry = catalogueEntries?.find((e) => e.id === catalogueId);
    if (entry !== undefined) {
      setName(entry.name);
      setDescription(entry.description);
    }
    setStep({
      id: 'confirm',
      type: step.id === 'standard' ? step.type : 'custom',
      catalogueId,
    });
  }

  function handleCustomSelect() {
    setName('');
    setDescription('');
    setStep({
      id: 'confirm',
      type: step.id === 'standard' ? step.type : 'custom',
      catalogueId: null,
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;
    create.mutate({
      name: name.trim(),
      description: description.trim(),
      type: step.id !== 'type' ? step.type : 'custom',
      catalogueId: step.id === 'confirm' && step.catalogueId !== null ? step.catalogueId : undefined,
      applicableSites: scopeMode === 'sites' ? selectedSiteIds : [],
      jurisdiction: jurisdiction.trim().length > 0 ? jurisdiction.trim() : undefined,
    });
  }

  function toggleSite(siteId: string) {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId],
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <Link
            href={`/${locale}/compliance`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backLink')}
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-sm font-medium">{t('title')}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10">

        {/* ── Step 1: Choose type ─────────────────────────────────────────────── */}
        {step.id === 'type' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">{t('step1Title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('selectStandard')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {FRAMEWORK_TYPES.map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => handleTypeSelect(ft)}
                  className={cn(
                    'group flex flex-col gap-2 rounded-xl border-2 bg-background p-5 text-left transition-colors',
                    'border-border hover:border-primary hover:bg-primary/5',
                  )}
                >
                  <span className="text-sm font-semibold">{t(`types.${ft}`)}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`typeDescriptions.${ft}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Step 2: Choose a standard (for non-custom types) ──────────────────── */}
        {step.id === 'standard' ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep({ id: 'type' })}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t('backToTypes')}
              </button>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-medium">{t(`types.${step.type}`)}</span>
            </div>

            <div>
              <h2 className="text-xl font-semibold">{t('step2Title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('selectStandard')}</p>
            </div>

            <div className="space-y-3">
              {/* Known catalogue entries */}
              {(catalogueEntries ?? []).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleStandardSelect(entry.id)}
                  className="group w-full rounded-xl border-2 border-border bg-background p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-semibold">{entry.name}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                        {entry.description}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('rulesPreviewHeading', { count: entry.ruleCount })}
                    </span>
                  </div>
                </button>
              ))}

              {/* Custom option */}
              <button
                type="button"
                onClick={handleCustomSelect}
                className="w-full rounded-xl border-2 border-dashed border-border bg-background p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <p className="font-semibold">{t('step2Custom')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('step2CustomDescription')}</p>
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 3: Confirm & create ───────────────────────────────────────────── */}
        {step.id === 'confirm' ? (
          <div className="space-y-6">
            {/* Breadcrumb back */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (step.type === 'custom') {
                    setStep({ id: 'type' });
                  } else {
                    setStep({ id: 'standard', type: step.type });
                  }
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t('backToStandards')}
              </button>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-medium">
                {step.catalogueId !== null ? name : t('step2Custom')}
              </span>
            </div>

            <h2 className="text-xl font-semibold">
              {step.catalogueId !== null ? t('step3Title') : t('step3TitleCustom')}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Auto-populated rules preview */}
              {step.catalogueId !== null && catalogueEntry !== undefined ? (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-5">
                    <button
                      type="button"
                      onClick={() => setRulesOpen((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          {t('autoPopulatedNote', { count: catalogueEntry.rules.length })}
                        </span>
                      </div>
                      {rulesOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {rulesOpen ? (
                      <div className="mt-4 space-y-2 border-t pt-4">
                        {catalogueEntry.rules.map((rule, i) => (
                          <div key={i} className="flex items-start gap-3 py-1">
                            <span className="mt-0.5 shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {rule.clauseRef}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{rule.name}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{rule.frequency}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {/* Name */}
              <div className="space-y-1.5">
                <label htmlFor="fw-name" className="text-sm font-medium">
                  {tCommon('name')} <span className="text-destructive">*</span>
                </label>
                <Input
                  id="fw-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  maxLength={500}
                  required
                  autoFocus={step.catalogueId === null}
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label htmlFor="fw-description" className="text-sm font-medium">
                  {tCommon('description')}
                </label>
                <textarea
                  id="fw-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                  rows={3}
                  maxLength={50_000}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* ── Scope ─────────────────────────────────────────────────────── */}
              <div className="rounded-xl border bg-background p-5 space-y-4">
                <div>
                  <p className="text-sm font-medium">{t('scopeLabel')}</p>
                </div>

                {/* Company-wide vs Specific sites toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScopeMode('company')}
                    className={cn(
                      'rounded-lg border-2 p-3 text-left text-sm transition-colors',
                      scopeMode === 'company'
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border hover:border-muted-foreground',
                    )}
                  >
                    <span className="block font-medium">{t('scopeCompanyWide')}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('scopeCompanyWideHint')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeMode('sites')}
                    className={cn(
                      'rounded-lg border-2 p-3 text-left text-sm transition-colors',
                      scopeMode === 'sites'
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border hover:border-muted-foreground',
                    )}
                  >
                    <span className="block font-medium">{t('scopeSpecificSites')}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('scopeSpecificSitesHint')}
                    </span>
                  </button>
                </div>

                {/* Site multi-select (shown only when 'sites' selected) */}
                {scopeMode === 'sites' ? (
                  <div className="space-y-2">
                    {sites.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('scopeSitesPlaceholder')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {sites.map((site) => (
                          <button
                            key={site.id}
                            type="button"
                            onClick={() => toggleSite(site.id)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs transition-colors',
                              selectedSiteIds.includes(site.id)
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background hover:border-primary',
                            )}
                          >
                            {site.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Jurisdiction */}
                <div className="space-y-1.5 border-t pt-4">
                  <label htmlFor="fw-jurisdiction" className="text-sm font-medium">
                    {t('jurisdictionLabel')}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {t('jurisdictionHint')}
                    </span>
                  </label>
                  <Input
                    id="fw-jurisdiction"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    placeholder={t('jurisdictionPlaceholder')}
                    maxLength={200}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (step.type === 'custom') setStep({ id: 'type' });
                    else setStep({ id: 'standard', type: step.type });
                  }}
                >
                  {tCommon('back')}
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending || name.trim().length === 0}
                >
                  {create.isPending ? t('creating') : tCommon('create')}
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
