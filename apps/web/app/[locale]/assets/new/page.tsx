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
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewAssetPage() {
  const t = useTranslations('assets.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [parentId, setParentId] = useState('');

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  // Only top-level assets can be parents (no parent themselves).
  const { data: topLevelAssets } = trpc.assets.list.useQuery({ parentId: null });
  const parentOptions = topLevelAssets ?? [];

  const create = trpc.assets.create.useMutation({
    onSuccess: ({ assetId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/assets/${assetId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;
    create.mutate({
      name: name.trim(),
      typeId: typeId !== '' ? typeId : undefined,
      parentId: parentId !== '' ? parentId : undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/assets`}
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
              <label htmlFor="asset-name" className="text-sm font-medium">
                {t('fields.name')}
              </label>
              <Input
                id="asset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="asset-type" className="text-sm font-medium">
                {t('fields.type')}
              </label>
              <select
                id="asset-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('fields.noType')}</option>
                {types.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="asset-parent" className="text-sm font-medium">
                {t('fields.parent')}
              </label>
              <select
                id="asset-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('fields.noParent')}</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" asChild>
                <Link href={`/${locale}/assets`}>{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
                {t('submitButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
