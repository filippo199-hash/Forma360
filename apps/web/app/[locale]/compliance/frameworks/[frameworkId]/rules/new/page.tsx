'use client';

import { Plus, Trash2, ChevronsUpDown, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { FocusedPageShell } from '../../../../../../../src/components/focused-page-shell';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../../../src/components/ui/card';
import { Input } from '../../../../../../../src/components/ui/input';
import { cn } from '../../../../../../../src/lib/cn';
import { trpc } from '../../../../../../../src/lib/trpc/client';

const RULE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'] as const;
const EVIDENCE_TYPES = [
  'inspection',
  'action',
  'document',
  'heads_up',
  'maintenance',
  'issue_sla',
  'training',
  'manual',
] as const;

type EvidenceType = (typeof EVIDENCE_TYPES)[number];

interface EvidenceItem {
  id: string;
  type: EvidenceType;
  // inspection
  templateId?: string;
  templateName?: string;
  frequencyDays?: string;
  // document
  documentId?: string;
  documentName?: string;
  freshnessDays?: string;
  // heads_up
  headsUpId?: string;
  headsUpTitle?: string;
  requireSignature?: boolean;
  // maintenance
  assetTypeId?: string;
  assetTypeName?: string;
  // issue_sla
  slaMaxDays?: string;
  // manual
  manualDescription?: string;
  manualValidityDays?: string;
}

function buildEvidenceConfig(item: EvidenceItem): unknown {
  switch (item.type) {
    case 'inspection':
      return {
        type: 'inspection',
        templateId: item.templateId ?? '',
        frequencyDays: item.frequencyDays ? Number(item.frequencyDays) : undefined,
      };
    case 'action':
      return { type: 'action' };
    case 'document':
      return {
        type: 'document',
        documentId: item.documentId !== undefined && item.documentId !== '' ? item.documentId : undefined,
        freshnessDays: item.freshnessDays ? Number(item.freshnessDays) : 30,
      };
    case 'heads_up':
      return {
        type: 'heads_up',
        headsUpId: item.headsUpId ?? '',
        requireSignature: item.requireSignature ?? false,
      };
    case 'maintenance':
      return {
        type: 'maintenance',
        assetTypeId: item.assetTypeId !== undefined && item.assetTypeId !== '' ? item.assetTypeId : undefined,
      };
    case 'issue_sla':
      return {
        type: 'issue_sla',
        slaMaxDays: item.slaMaxDays ? Number(item.slaMaxDays) : 30,
      };
    case 'training':
      return { type: 'training' };
    case 'manual':
      return {
        type: 'manual',
        description: item.manualDescription ?? '',
        validityDays: item.manualValidityDays ? Number(item.manualValidityDays) : undefined,
      };
    default:
      return { type: item.type };
  }
}

let nextEvidenceId = 1;

// ── Generic searchable select ────────────────────────────────────────────────

interface SelectOption {
  id: string;
  label: string;
}

interface EntitySelectProps {
  value: string | undefined;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  options: SelectOption[];
  loading?: boolean;
  onChange: (id: string, label: string) => void;
}

function EntitySelect({ value, label, placeholder, searchPlaceholder, options, loading, onChange }: EntitySelectProps) {
  const tSel = useTranslations('entitySelect');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = query.length > 0
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedLabel = options.find((o) => o.id === value)?.label ?? '';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn(value !== undefined && value !== '' ? 'text-foreground' : 'text-muted-foreground')}>
          {value !== undefined && value !== '' ? selectedLabel : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-sm border border-input bg-background px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {loading === true ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{tSel('loading')}</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{tSel('noResults')}</p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt.id, opt.label);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === opt.id ? 'opacity-100' : 'opacity-0')} />
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {/* Hidden label for the parent so it renders the selected display name */}
      <span className="sr-only">{label}: {selectedLabel}</span>
    </div>
  );
}

// ── Evidence type config forms ────────────────────────────────────────────────

interface EvidenceFieldsProps {
  item: EvidenceItem;
  update: (patch: Partial<EvidenceItem>) => void;
}

function InspectionFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  const { data: templates, isLoading } = trpc.templates.list.useQuery({ includeArchived: false });
  const options: SelectOption[] = (templates ?? []).map((tmpl) => ({ id: tmpl.id, label: tmpl.name }));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('templateLabel')}</label>
        <EntitySelect
          value={item.templateId}
          label={t('templateLabel')}
          placeholder={t('templatePlaceholder')}
          searchPlaceholder={t('templateSearchPlaceholder')}
          options={options}
          loading={isLoading}
          onChange={(id) => update({ templateId: id })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('frequencyDays')}</label>
        <Input
          type="number"
          min={1}
          value={item.frequencyDays ?? ''}
          onChange={(e) => update({ frequencyDays: e.target.value })}
          placeholder="30"
        />
      </div>
    </div>
  );
}

function DocumentFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  const { data: docs, isLoading } = trpc.documents.list.useQuery({});
  const options: SelectOption[] = (docs ?? []).map((d) => ({ id: d.id, label: d.name }));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('documentLabel')}</label>
        <EntitySelect
          value={item.documentId}
          label={t('documentLabel')}
          placeholder={t('documentPlaceholder')}
          searchPlaceholder={t('documentSearchPlaceholder')}
          options={options}
          loading={isLoading}
          onChange={(id) => update({ documentId: id })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('freshnessDays')}</label>
        <Input
          type="number"
          min={1}
          value={item.freshnessDays ?? ''}
          onChange={(e) => update({ freshnessDays: e.target.value })}
          placeholder="30"
          className="w-32"
        />
      </div>
    </div>
  );
}

function HeadsUpFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  const { data: list, isLoading } = trpc.headsUps.list.useQuery({});
  const options: SelectOption[] = (list ?? []).map((h) => ({ id: h.id, label: h.title }));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('headsUpLabel')}</label>
        <EntitySelect
          value={item.headsUpId}
          label={t('headsUpLabel')}
          placeholder={t('headsUpPlaceholder')}
          searchPlaceholder={t('headsUpSearchPlaceholder')}
          options={options}
          loading={isLoading}
          onChange={(id) => update({ headsUpId: id })}
        />
      </div>
      <div className="flex items-center gap-2 pt-5">
        <input
          type="checkbox"
          id={`req-sig-${item.id}`}
          checked={item.requireSignature ?? false}
          onChange={(e) => update({ requireSignature: e.target.checked })}
          className="h-4 w-4"
        />
        <label htmlFor={`req-sig-${item.id}`} className="text-sm">
          {t('requireSignature')}
        </label>
      </div>
    </div>
  );
}

function MaintenanceFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  const { data: types, isLoading } = trpc.assetTypes.list.useQuery({});
  const options: SelectOption[] = (types ?? []).map((at) => ({ id: at.id, label: at.name }));

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{t('assetTypeLabel')}</label>
      <EntitySelect
        value={item.assetTypeId}
        label={t('assetTypeLabel')}
        placeholder={t('assetTypePlaceholder')}
        searchPlaceholder={t('assetTypeSearchPlaceholder')}
        options={options}
        loading={isLoading}
        onChange={(id) => update({ assetTypeId: id })}
      />
    </div>
  );
}

function IssueSlaFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{t('slaMaxDays')}</label>
      <Input
        type="number"
        min={1}
        value={item.slaMaxDays ?? ''}
        onChange={(e) => update({ slaMaxDays: e.target.value })}
        placeholder="30"
        className="w-32"
      />
    </div>
  );
}

function ManualFields({ item, update }: EvidenceFieldsProps) {
  const t = useTranslations('compliance.rules.new.evidence');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <label className="text-xs font-medium">{t('manualDescription')}</label>
        <Input
          value={item.manualDescription ?? ''}
          onChange={(e) => update({ manualDescription: e.target.value })}
          placeholder={t('manualDescriptionPlaceholder')}
          maxLength={500}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">{t('manualValidityDays')}</label>
        <Input
          type="number"
          min={1}
          value={item.manualValidityDays ?? ''}
          onChange={(e) => update({ manualValidityDays: e.target.value })}
          placeholder="365"
          className="w-32"
        />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewRulePage() {
  const t = useTranslations('compliance.rules.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; frameworkId: string }>();
  const locale = params.locale ?? 'en';
  const frameworkId = params.frameworkId ?? '';
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clauseRef, setClauseRef] = useState('');
  const [frequency, setFrequency] = useState<(typeof RULE_FREQUENCIES)[number]>('monthly');
  const [dueSoonDays, setDueSoonDays] = useState('7');
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);

  const createRule = trpc.compliance.rules.create.useMutation({
    onSuccess: async ({ ruleId }) => {
      // Create each evidence requirement
      for (const item of evidenceItems) {
        try {
          await createEvidence.mutateAsync({
            ruleId,
            evidenceType: item.type,
            config: buildEvidenceConfig(item) as Parameters<typeof createEvidence.mutateAsync>[0]['config'],
          });
        } catch {
          // Best-effort; the rule is created regardless
        }
      }
      toast.success(t('createdToast'));
      router.push(`/${locale}/compliance/frameworks/${frameworkId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const createEvidence = trpc.compliance.evidence.create.useMutation();

  function addEvidence() {
    setEvidenceItems((prev) => [
      ...prev,
      { id: String(nextEvidenceId++), type: 'inspection' },
    ]);
  }

  function removeEvidence(id: string) {
    setEvidenceItems((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEvidence(id: string, patch: Partial<EvidenceItem>) {
    setEvidenceItems((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;
    createRule.mutate({
      frameworkId,
      name: name.trim(),
      description: description.trim(),
      clauseRef: clauseRef.trim(),
      frequency,
      dueSoonDays: Number(dueSoonDays) || 7,
    });
  }

  const isSubmitting = createRule.isPending;

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/compliance/frameworks/${frameworkId}`} width="form">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">{t('ruleDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="rule-name" className="text-sm font-medium">
                {tCommon('name')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rule-description" className="text-sm font-medium">
                {tCommon('description')}
              </label>
              <textarea
                id="rule-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={50_000}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="rule-clause" className="text-sm font-medium">
                  {t('clauseRefLabel')}
                </label>
                <Input
                  id="rule-clause"
                  value={clauseRef}
                  onChange={(e) => setClauseRef(e.target.value)}
                  placeholder={t('clauseRefPlaceholder')}
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rule-frequency" className="text-sm font-medium">
                  {t('frequencyLabel')}
                </label>
                <select
                  id="rule-frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {RULE_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(`frequencies.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rule-due-soon" className="text-sm font-medium">
                {t('dueSoonDaysLabel')}
              </label>
              <Input
                id="rule-due-soon"
                type="number"
                min={1}
                max={365}
                value={dueSoonDays}
                onChange={(e) => setDueSoonDays(e.target.value)}
                className="w-32"
              />
            </div>
          </CardContent>
        </Card>

        {/* Evidence requirements */}
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t('evidenceTitle')}</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addEvidence}>
                <Plus className="mr-1 h-4 w-4" />
                {t('addEvidenceButton')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {evidenceItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noEvidenceYet')}</p>
            ) : (
              evidenceItems.map((item) => (
                <div key={item.id} className="rounded-lg border p-4 space-y-3">
                  {/* Type selector + remove */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('evidenceTypeLabel')}
                      </label>
                      <select
                        value={item.type}
                        onChange={(e) =>
                          updateEvidence(item.id, { type: e.target.value as EvidenceType })
                        }
                        className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      >
                        {EVIDENCE_TYPES.map((et) => (
                          <option key={et} value={et}>
                            {t(`evidenceTypes.${et}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEvidence(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  {/* Type-specific config */}
                  {item.type === 'inspection' ? (
                    <InspectionFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'document' ? (
                    <DocumentFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'heads_up' ? (
                    <HeadsUpFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'maintenance' ? (
                    <MaintenanceFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'issue_sla' ? (
                    <IssueSlaFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'manual' ? (
                    <ManualFields item={item} update={(p) => updateEvidence(item.id, p)} />
                  ) : null}
                  {item.type === 'action' ? (
                    <p className="text-xs text-muted-foreground">
                      {t('evidenceTypes.action')}
                    </p>
                  ) : null}
                  {item.type === 'training' ? (
                    <p className="text-xs text-muted-foreground">
                      {t('evidenceTypes.training')}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 max-w-2xl">
          <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
            {isSubmitting ? t('creating') : tCommon('create')}
          </Button>
        </div>
      </form>
    </FocusedPageShell>
  );
}
