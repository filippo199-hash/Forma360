'use client';

import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../../../src/components/ui/card';
import { Input } from '../../../../../../../src/components/ui/input';
import { trpc } from '../../../../../../../src/lib/trpc/client';

const RULE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'] as const;
const EVIDENCE_TYPES = [
  'inspection',
  'action',
  'document',
  'heads_up',
  'maintenance',
] as const;

type EvidenceType = (typeof EVIDENCE_TYPES)[number];

interface EvidenceItem {
  id: string;
  type: EvidenceType;
  // inspection
  templateId?: string;
  frequencyDays?: string;
  // document
  freshnessDays?: string;
  // heads_up
  headsUpId?: string;
  requireSignature?: boolean;
  // maintenance
  assetTypeId?: string;
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
        assetTypeId: item.assetTypeId !== '' ? item.assetTypeId : undefined,
      };
    default:
      return { type: item.type };
  }
}

let nextEvidenceId = 1;

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
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/${locale}/compliance/frameworks/${frameworkId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">{t('evidence.templateId')}</label>
                        <Input
                          value={item.templateId ?? ''}
                          onChange={(e) => updateEvidence(item.id, { templateId: e.target.value })}
                          placeholder={t('evidence.templateIdPlaceholder')}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">{t('evidence.frequencyDays')}</label>
                        <Input
                          type="number"
                          min={1}
                          value={item.frequencyDays ?? ''}
                          onChange={(e) => updateEvidence(item.id, { frequencyDays: e.target.value })}
                          placeholder="30"
                        />
                      </div>
                    </div>
                  ) : null}

                  {item.type === 'document' ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium">{t('evidence.freshnessDays')}</label>
                      <Input
                        type="number"
                        min={1}
                        value={item.freshnessDays ?? ''}
                        onChange={(e) => updateEvidence(item.id, { freshnessDays: e.target.value })}
                        placeholder="30"
                        className="w-32"
                      />
                    </div>
                  ) : null}

                  {item.type === 'heads_up' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">{t('evidence.headsUpId')}</label>
                        <Input
                          value={item.headsUpId ?? ''}
                          onChange={(e) => updateEvidence(item.id, { headsUpId: e.target.value })}
                          placeholder={t('evidence.headsUpIdPlaceholder')}
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-5">
                        <input
                          type="checkbox"
                          id={`req-sig-${item.id}`}
                          checked={item.requireSignature ?? false}
                          onChange={(e) =>
                            updateEvidence(item.id, { requireSignature: e.target.checked })
                          }
                          className="h-4 w-4"
                        />
                        <label htmlFor={`req-sig-${item.id}`} className="text-sm">
                          {t('evidence.requireSignature')}
                        </label>
                      </div>
                    </div>
                  ) : null}

                  {item.type === 'maintenance' ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium">{t('evidence.assetTypeId')}</label>
                      <Input
                        value={item.assetTypeId ?? ''}
                        onChange={(e) => updateEvidence(item.id, { assetTypeId: e.target.value })}
                        placeholder={t('evidence.assetTypeIdPlaceholder')}
                      />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 max-w-2xl">
          <Button type="button" variant="ghost" asChild>
            <Link href={`/${locale}/compliance/frameworks/${frameworkId}`}>
              {tCommon('cancel')}
            </Link>
          </Button>
          <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
            {isSubmitting ? t('creating') : tCommon('create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
