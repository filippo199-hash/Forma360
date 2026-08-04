'use client';

/**
 * Method-statement library.
 *
 * The adoption feature: a contractor does the same twelve jobs
 * repeatedly, so a pack that starts blank means they keep using Word.
 * The starter set seeds on first visit; everything is duplicate-and-
 * tailor from there.
 */
import { Copy, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { METHOD_STATEMENT_TRADES, type MethodStatementTrade } from '@forma360/shared/rams';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type TradeFilter = MethodStatementTrade | 'all';

export default function RamsLibraryPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const router = useRouter();
  const canCreate = useHasPermission('rams.create');
  const canManage = useHasPermission('rams.manage');

  const [trade, setTrade] = useState<TradeFilter>('all');
  // RS-A14: seed and duplicate failed silently — the list simply did not change.
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const list = trpc.rams.methodStatements.list.useQuery({
    templatesOnly: true,
    ...(trade !== 'all' ? { trade } : {}),
  });
  const seed = trpc.rams.methodStatements.seedLibrary.useMutation({
    onSuccess: () => {
      setLibraryError(null);
      void utils.rams.methodStatements.list.invalidate();
    },
    onError: (err) => setLibraryError(err.message),
  });
  const duplicate = trpc.rams.methodStatements.create.useMutation({
    onSuccess: () => {
      setLibraryError(null);
      void utils.rams.methodStatements.list.invalidate();
    },
    onError: (err) => setLibraryError(err.message),
  });

  // Seed the starter set the first time anyone opens the library.
  const count = list.data?.length;
  useEffect(() => {
    if (canManage && count === 0 && seed.isIdle && !seed.isPending && trade === 'all') {
      seed.mutate();
    }
  }, [canManage, count, seed, trade]);

  const rows = list.data ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('library.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('library.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/${locale}/rams`}>{t('library.backToRegister')}</Link>
          </Button>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={seed.isPending}
              onClick={() => seed.mutate()}
            >
              {t('library.restoreStarters')}
            </Button>
          ) : null}
        </div>
      </header>

      {libraryError !== null ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {libraryError}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1">
        {(['all', ...METHOD_STATEMENT_TRADES] as ReadonlyArray<TradeFilter>).map((tr) => (
          <button
            key={tr}
            type="button"
            onClick={() => setTrade(tr)}
            className={`rounded-full border px-3 py-1 text-sm ${
              trade === tr ? 'bg-foreground text-background' : 'hover:bg-muted'
            }`}
          >
            {tr === 'all' ? t('filters.all') : t(`trade.${tr}`)}
          </button>
        ))}
      </div>

      {list.isPending || seed.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">{t('library.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((ms) => (
            <Card key={ms.id}>
              <CardContent className="py-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{ms.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {t(`trade.${ms.trade}`)} · {t('new.stepCount', { count: ms.stepCount })}
                      {ms.currentVersion > 0
                        ? ` · ${t('versionLabel', { version: ms.currentVersion })}`
                        : ''}
                    </div>
                  </div>
                  {ms.isSeeded ? (
                    <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                      {t('library.starter')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canCreate ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => router.push(`/${locale}/rams/new?methodStatementId=${ms.id}`)}
                    >
                      <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                      {t('library.startPack')}
                    </Button>
                  ) : null}
                  {canCreate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={duplicate.isPending}
                      onClick={() =>
                        duplicate.mutate({
                          title: `${ms.title} (${t('library.copySuffix')})`,
                          trade: ms.trade,
                          isTemplate: true,
                          fromMethodStatementId: ms.id,
                        })
                      }
                    >
                      <Copy className="mr-1.5 h-4 w-4" aria-hidden />
                      {t('library.duplicate')}
                    </Button>
                  ) : null}
                  {/* RS-A12: the library was read-and-clone only — a
                      duplicated template could never be changed. */}
                  {canCreate ? (
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link href={`/${locale}/rams/library/${ms.id}`}>
                        <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                        {t('library.edit')}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
