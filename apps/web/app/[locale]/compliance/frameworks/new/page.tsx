'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { trpc } from '../../../../../src/lib/trpc/client';

const FRAMEWORK_TYPES = [
  'health_safety',
  'quality',
  'environmental',
  'regulatory',
  'custom',
] as const;

export default function NewFrameworkPage() {
  const t = useTranslations('compliance.frameworks.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<(typeof FRAMEWORK_TYPES)[number]>('custom');
  const [targetScore, setTargetScore] = useState('');

  const create = trpc.compliance.frameworks.create.useMutation({
    onSuccess: ({ frameworkId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/compliance/frameworks/${frameworkId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;
    const parsedTarget = targetScore.trim().length > 0 ? Number(targetScore) : undefined;
    if (parsedTarget !== undefined && (isNaN(parsedTarget) || parsedTarget < 0 || parsedTarget > 100)) {
      toast.error(t('targetScoreInvalid'));
      return;
    }
    create.mutate({
      name: name.trim(),
      description: description.trim(),
      type,
      targetScore: parsedTarget,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/${locale}/compliance`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <Card className="max-w-xl">
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
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
              />
            </div>

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

            <div className="space-y-1.5">
              <label htmlFor="fw-type" className="text-sm font-medium">
                {t('typeLabel')}
              </label>
              <select
                id="fw-type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {FRAMEWORK_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {t(`types.${ft}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="fw-target-score" className="text-sm font-medium">
                {t('targetScoreLabel')}
                <span className="ml-1 text-xs text-muted-foreground">{t('targetScoreHint')}</span>
              </label>
              <Input
                id="fw-target-score"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={targetScore}
                onChange={(e) => setTargetScore(e.target.value)}
                placeholder="80"
              />
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" asChild>
                <Link href={`/${locale}/compliance`}>{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
                {create.isPending ? t('creating') : tCommon('create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
