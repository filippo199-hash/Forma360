'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewHeadsUpPage() {
  const t = useTranslations('headsUp.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [engagementLevel, setEngagementLevel] = useState<'view' | 'acknowledge' | 'sign'>('view');
  const [requireAcknowledgement, setRequireAcknowledgement] = useState(false);
  const [requireSignature, setRequireSignature] = useState(false);

  const create = trpc.headsUps.create.useMutation({
    onSuccess: ({ headsUpId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/heads-up/${headsUpId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length === 0) return;
    create.mutate({
      title: title.trim(),
      description: description.trim(),
      engagementLevel,
      requireAcknowledgement: engagementLevel !== 'view' ? requireAcknowledgement : false,
      requireSignature: engagementLevel === 'sign' ? requireSignature : false,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/heads-up`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="hu-title" className="text-sm font-medium">
                {t('fields.title')}
              </label>
              <Input
                id="hu-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('fields.titlePlaceholder')}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="hu-desc" className="text-sm font-medium">
                {t('fields.description')}
              </label>
              <Textarea
                id="hu-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('fields.descriptionPlaceholder')}
                rows={5}
                maxLength={50_000}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('fields.engagementLevel')}</label>
              <div className="flex flex-wrap gap-3">
                {(['view', 'acknowledge', 'sign'] as const).map((lvl) => (
                  <label key={lvl} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="engagementLevel"
                      value={lvl}
                      checked={engagementLevel === lvl}
                      onChange={() => setEngagementLevel(lvl)}
                      className="h-4 w-4"
                    />
                    {t(`engagement.${lvl}`)}
                  </label>
                ))}
              </div>
            </div>

            {engagementLevel !== 'view' ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requireAcknowledgement}
                  onChange={(e) => setRequireAcknowledgement(e.target.checked)}
                  className="h-4 w-4"
                />
                {t('fields.requireAcknowledgement')}
              </label>
            ) : null}

            {engagementLevel === 'sign' ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requireSignature}
                  onChange={(e) => setRequireSignature(e.target.checked)}
                  className="h-4 w-4"
                />
                {t('fields.requireSignature')}
              </label>
            ) : null}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" asChild>
                <Link href={`/${locale}/heads-up`}>{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={create.isPending || title.trim().length === 0}>
                {t('submitButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
