'use client';

import { ArrowLeft, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

export default function ContractorTemplatesPage() {
  const t = useTranslations('contractors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contractors.templates.list.useQuery();
  const rows = data ?? [];

  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [blocking, setBlocking] = useState(true);

  const create = trpc.contractors.templates.create.useMutation({
    onSuccess: () => {
      void utils.contractors.templates.list.invalidate();
      setName('');
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('error')),
  });
  const remove = trpc.contractors.templates.remove.useMutation({
    onSuccess: () => void utils.contractors.templates.list.invalidate(),
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('error')),
  });

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/contractors`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('templatesTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('templatesSubtitle')}</p>
      </header>

      {canManage ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('templateCategory')}
              </label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120} />
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('templateName')}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('reqNamePlaceholder')}
                maxLength={200}
              />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input
                type="checkbox"
                checked={blocking}
                onChange={(e) => setBlocking(e.target.checked)}
              />
              {t('reqBlocking')}
            </label>
            <Button
              disabled={create.isPending || category.trim() === '' || name.trim() === ''}
              onClick={() =>
                create.mutate({ category: category.trim(), name: name.trim(), blocking })
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('addTemplate')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('templatesEmpty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('templateCategory')}</th>
                  <th className="px-4 py-3 font-medium">{t('templateName')}</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{r.category}</td>
                    <td className="px-4 py-2.5">
                      {r.name}
                      {!r.blocking ? (
                        <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {t('reqAdvisory')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => remove.mutate({ id: r.id })}
                          aria-label={t('reqRemove')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
