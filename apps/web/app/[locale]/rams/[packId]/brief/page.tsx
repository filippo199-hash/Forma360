'use client';

/**
 * Briefing — "briefed and understood".
 *
 * The most-used surface in the module, and the one that must work on a
 * phone in a plant room with no signal:
 *   - read the steps (hold points called out prominently), then capture
 *     signatures one after another without leaving the flow — that is
 *     how a tailgate talk actually happens;
 *   - anything captured offline queues in `localStorage` and syncs when
 *     the connection returns;
 *   - **sync failures are surfaced, never swallowed** (the incidents
 *     IN-A4 / IN-A12 lesson): the queue banner stays visible with a
 *     manual retry until the server has actually accepted the rows.
 */
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BRIEFEE_CATEGORIES, type BriefeeCategory } from '@forma360/shared/rams';
import { HoldPointChip } from '../../../../../src/components/rams/chips';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { trpc } from '../../../../../src/lib/trpc/client';

interface QueuedEntry {
  name: string;
  category: BriefeeCategory;
  organisation: string;
  questionsNote: string;
}

const queueKey = (packId: string): string => `rams-briefing-queue:${packId}`;

function loadQueue(packId: string): QueuedEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(queueKey(packId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedEntry[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(packId: string, entries: QueuedEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(queueKey(packId), JSON.stringify(entries));
  } catch {
    // Storage full or blocked — the in-memory queue still shows in the
    // banner, so the operator is not told the briefing was saved.
  }
}

export default function RamsBriefPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string; packId: string }>();
  const { locale, packId } = params;

  const utils = trpc.useUtils();
  const brief = trpc.rams.briefings.forPack.useQuery({ packId });

  const [name, setName] = useState('');
  const [category, setCategory] = useState<BriefeeCategory>('employee');
  const [organisation, setOrganisation] = useState('');
  const [questionsNote, setQuestionsNote] = useState('');
  const [queue, setQueue] = useState<QueuedEntry[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setQueue(loadQueue(packId));
  }, [packId]);

  const record = trpc.rams.briefings.record.useMutation();

  /**
   * Drain the offline queue. Any failure leaves the entries in place and
   * surfaces the error — a briefing that silently vanished is worse than
   * one that visibly needs retrying.
   */
  const flush = useCallback(
    async (entries: QueuedEntry[]): Promise<void> => {
      if (entries.length === 0) return;
      try {
        await record.mutateAsync({
          packId,
          entries: entries.map((e) => ({
            kind: 'named_person' as const,
            name: e.name,
            category: e.category,
            organisation: e.organisation,
            questionsNote: e.questionsNote,
          })),
        });
        setQueue([]);
        saveQueue(packId, []);
        setSyncError(null);
        void utils.rams.briefings.forPack.invalidate({ packId });
        void utils.rams.packs.get.invalidate({ packId });
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : String(err));
      }
    },
    [packId, record, utils],
  );

  // Retry automatically when the browser says we are back online.
  useEffect(() => {
    const onOnline = (): void => {
      void flush(loadQueue(packId));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [packId, flush]);

  // Warn before leaving with unsynced briefings.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (queue.length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [queue.length]);

  function submitOne(): void {
    const entry: QueuedEntry = {
      name: name.trim(),
      category,
      organisation: organisation.trim(),
      questionsNote: questionsNote.trim(),
    };
    if (entry.name.length === 0) return;

    // Clear the form immediately so the phone can be passed on — the
    // queue is what guarantees the record survives.
    setName('');
    setOrganisation('');
    setQuestionsNote('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);

    const next = [...queue, entry];
    setQueue(next);
    saveQueue(packId, next);
    void flush(next);
  }

  if (brief.isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (brief.error !== null) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <p className="text-destructive">{brief.error.message}</p>
      </main>
    );
  }

  const data = brief.data;
  const version = data.currentVersion;

  if (version === null) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <p className="text-muted-foreground">{t('briefing.notIssued')}</p>
        <Button asChild type="button" variant="outline" size="sm" className="mt-3">
          <Link href={`/${locale}/rams/${packId}`}>{t('builder.backToPack')}</Link>
        </Button>
      </main>
    );
  }

  const steps = version.content.content.steps;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{data.pack.title}</h1>
        <p className="text-muted-foreground text-sm">
          {t('versionLabel', { version: version.versionNumber })} ·{' '}
          {t('briefing.briefedSoFar', { count: data.briefedOnCurrent })}
        </p>
      </header>

      {queue.length > 0 ? (
        <Card className="mb-4 border-amber-500">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {t('briefing.queued', { count: queue.length })}
                </p>
                {syncError !== null ? (
                  <p className="text-destructive mt-1 flex items-start gap-1 text-xs">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {syncError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={record.isPending}
                onClick={() => void flush(queue)}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
                {t('briefing.retry')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* The brief itself */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <h2 className="mb-2 font-semibold">{t('briefing.readThis')}</h2>
          {version.content.content.scopeOfWorks.length > 0 ? (
            <p className="mb-3 text-sm whitespace-pre-wrap">
              {version.content.content.scopeOfWorks}
            </p>
          ) : null}
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.id} className="border-l-2 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {s.sequence}. {s.title}
                  </span>
                  {s.holdPoint !== null ? <HoldPointChip /> : null}
                </div>
                {s.description.length > 0 ? (
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                    {s.description}
                  </p>
                ) : null}
                {s.holdPoint !== null ? (
                  <p className="mt-1 rounded bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    {s.holdPoint.description}
                  </p>
                ) : null}
                {s.ppe.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('steps.ppe')}: {s.ppe.map((p) => t(`ppe.${p}`)).join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-4 border-t pt-3">
            <h3 className="mb-1 text-sm font-semibold">{t('emergency.title')}</h3>
            <p className="text-sm whitespace-pre-wrap">
              {version.content.content.emergency.firstAid}
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap">
              {version.content.content.emergency.emergencyProcedure}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Capture — pass the phone around */}
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <h2 className="font-semibold">{t('briefing.signHere')}</h2>
          <div>
            <Label htmlFor="briefee-name">{t('briefing.name')}</Label>
            <Input
              id="briefee-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="briefee-category">{t('briefing.category')}</Label>
              <select
                id="briefee-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BriefeeCategory)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {BRIEFEE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`briefeeCategory.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="briefee-org">{t('briefing.organisation')}</Label>
              <Input
                id="briefee-org"
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="briefee-questions">{t('briefing.questions')}</Label>
            <Textarea
              id="briefee-questions"
              rows={2}
              value={questionsNote}
              onChange={(e) => setQuestionsNote(e.target.value)}
            />
          </div>
          <p className="text-muted-foreground text-xs">{t('briefing.understoodStatement')}</p>
          <Button
            type="button"
            className="w-full"
            disabled={name.trim().length === 0}
            onClick={submitOne}
          >
            {justSaved ? (
              <>
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
                {t('briefing.recorded')}
              </>
            ) : (
              t('briefing.confirm')
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Who has signed */}
      <Card>
        <CardContent className="py-4">
          <h2 className="mb-2 font-semibold">{t('briefing.register')}</h2>
          {data.briefings.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('briefing.nobodyYet')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.briefings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span className={b.current ? '' : 'text-muted-foreground line-through'}>
                    {b.briefeeName}
                  </span>
                  {b.briefeeOrganisation.length > 0 ? (
                    <span className="text-muted-foreground text-xs">{b.briefeeOrganisation}</span>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    {t('versionLabel', { version: b.versionNumber })}
                  </span>
                  {!b.current ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {t('briefing.needsRebrief')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
