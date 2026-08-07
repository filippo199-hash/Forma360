'use client';

import { ArrowLeft, Info, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { contractorErrorMessage } from '../../../../src/lib/contractor-errors';
import { trpc } from '../../../../src/lib/trpc/client';

type TemplateRow = { id: string; category: string; name: string; blocking: boolean };

export default function ContractorTemplatesPage() {
  const t = useTranslations('contractors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.contractors.templates.list.useQuery();
  const rows = (data ?? []) as TemplateRow[];

  // Group templates by category so it's obvious a trade can require many docs.
  const byCategory = useMemo(() => {
    const map = new Map<string, TemplateRow[]>();
    for (const r of rows) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const invalidate = () => void utils.contractors.templates.list.invalidate();
  const onErr = (err: { message: string }) => toast.error(contractorErrorMessage(err.message, t));

  const create = trpc.contractors.templates.create.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const remove = trpc.contractors.templates.remove.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });

  // "New category" form.
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [blocking, setBlocking] = useState(true);

  // Per-category "add another document" inputs, keyed by category.
  const [addName, setAddName] = useState<Record<string, string>>({});
  const [addBlocking, setAddBlocking] = useState<Record<string, boolean>>({});

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

      {/* What "blocking" means. */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{t('templateBlockingHelp')}</p>
      </div>

      {canManage ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">{t('addCategoryHeading')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px] flex-1 space-y-1.5">
                <Label>{t('templateCategory')}</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={120}
                  placeholder={t('templateCategoryPlaceholder')}
                />
              </div>
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label>{t('templateName')}</Label>
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
                  create.mutate(
                    { category: category.trim(), name: name.trim(), blocking },
                    { onSuccess: () => setName('') },
                  )
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('addTemplate')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : byCategory.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('templatesEmpty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {byCategory.map(([cat, docs]) => (
            <Card key={cat}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-base font-semibold">{cat}</h2>
                  <span className="text-xs text-muted-foreground">
                    {t('templateDocCount', { count: docs.length })}
                  </span>
                </div>
                <ul className="divide-y">
                  {docs.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="flex-1">
                        {r.name}
                        <span
                          className={
                            r.blocking
                              ? 'ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-100'
                              : 'ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'
                          }
                        >
                          {r.blocking ? t('reqBlockingShort') : t('reqAdvisory')}
                        </span>
                      </span>
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
                    </li>
                  ))}
                </ul>

                {/* Add another document to this category. */}
                {canManage ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    <Input
                      value={addName[cat] ?? ''}
                      onChange={(e) => setAddName((s) => ({ ...s, [cat]: e.target.value }))}
                      placeholder={t('addDocPlaceholder')}
                      maxLength={200}
                      className="h-9 min-w-[200px] flex-1"
                    />
                    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={addBlocking[cat] ?? true}
                        onChange={(e) => setAddBlocking((s) => ({ ...s, [cat]: e.target.checked }))}
                      />
                      {t('reqBlocking')}
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={create.isPending || (addName[cat] ?? '').trim() === ''}
                      onClick={() =>
                        create.mutate(
                          {
                            category: cat,
                            name: (addName[cat] ?? '').trim(),
                            blocking: addBlocking[cat] ?? true,
                          },
                          { onSuccess: () => setAddName((s) => ({ ...s, [cat]: '' })) },
                        )
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t('addDocument')}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
