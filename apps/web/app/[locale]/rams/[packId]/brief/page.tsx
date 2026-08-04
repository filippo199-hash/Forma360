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
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRIEFEE_CATEGORIES, type BriefeeCategory } from '@forma360/shared/rams';
import { SignaturePad } from '../../../../../src/components/inspections/signature-pad';
import { HoldPointChip } from '../../../../../src/components/rams/chips';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { trpc } from '../../../../../src/lib/trpc/client';

interface QueuedEntry {
  /**
   * RS-A7: the idempotency key. The router accepts `clientRef` "so an
   * offline replay is idempotent"; it now stores it behind a unique
   * index, so re-sending an entry that already landed is a no-op
   * instead of a second row for the same operative.
   */
  clientRef: string;
  name: string;
  category: BriefeeCategory;
  organisation: string;
  questionsNote: string;
  signatureData: string | null;
}

function newClientRef(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  const [signature, setSignature] = useState<string | null>(null);
  const flushing = useRef(false);

  useEffect(() => {
    setQueue(loadQueue(packId));
  }, [packId]);

  const record = trpc.rams.briefings.record.useMutation();

  /**
   * Drain the offline queue (RS-A7).
   *
   * Three bugs lived here. The flush sent the *whole* queue, so
   * recording a second briefee while the first was still in flight
   * re-sent the first and recorded that operative twice. A successful
   * flush then cleared the entire queue rather than the entries it had
   * actually sent, erasing anything added mid-flight, unsent. And both
   * were masked by an optimistic "Recorded ✓" that fired before the
   * server answered.
   *
   * Now: one flush at a time (`flushing`), send exactly the snapshot
   * taken at entry, and remove only those `clientRef`s from whatever the
   * queue has become. `clientRef` is stored server-side behind a unique
   * index, so even a retry that duplicates on the wire cannot duplicate
   * in the record.
   */
  const flush = useCallback(
    async (entries: QueuedEntry[]): Promise<void> => {
      if (entries.length === 0 || flushing.current) return;
      flushing.current = true;
      const sending = [...entries];
      try {
        await record.mutateAsync({
          packId,
          entries: sending.map((e) => ({
            kind: 'named_person' as const,
            clientRef: e.clientRef,
            name: e.name,
            category: e.category,
            organisation: e.organisation,
            questionsNote: e.questionsNote,
            ...(e.signatureData !== null ? { signatureData: e.signatureData } : {}),
          })),
        });
        const sentRefs = new Set(sending.map((e) => e.clientRef));
        setQueue((current) => {
          const remaining = current.filter((e) => !sentRefs.has(e.clientRef));
          saveQueue(packId, remaining);
          return remaining;
        });
        setSyncError(null);
        void utils.rams.briefings.forPack.invalidate({ packId });
        void utils.rams.packs.get.invalidate({ packId });
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : String(err));
      } finally {
        flushing.current = false;
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

  // RS-A7: …and on a timer, because a phone that never fires an `online`
  // event otherwise just sits there holding the briefing register.
  useEffect(() => {
    if (queue.length === 0) return undefined;
    const timer = setInterval(() => {
      void flush(loadQueue(packId));
    }, 20_000);
    return () => clearInterval(timer);
  }, [queue.length, packId, flush]);

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
      clientRef: newClientRef(),
      name: name.trim(),
      category,
      organisation: organisation.trim(),
      questionsNote: questionsNote.trim(),
      signatureData: signature,
    };
    if (entry.name.length === 0) return;

    // Clear the form immediately so the phone can be passed on — the
    // queue is what guarantees the record survives. No optimistic
    // "Recorded ✓" (RS-A7): the queue banner is the honest status, and
    // it clears itself when the server has actually taken the entry.
    setName('');
    setOrganisation('');
    setQuestionsNote('');
    setSignature(null);

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
  // RS-A6: hazards + controls travel in the frozen snapshot now, so the
  // briefing shows the RA half of "RAMS". Packs issued before that has
  // no hazards in their content and simply render the steps, as before.
  const hazards = version.content.riskAssessments.flatMap((ra) =>
    (ra.hazards ?? []).map((h) => ({ ...h, raVersionId: ra.raVersionId })),
  );
  const coshh = version.content.coshh;

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

          {/* RS-A6: the risks, on the one screen where the risk
              assessment actually reaches a human. The steps alone are a
              method statement; a crew cannot be briefed on a RAMS
              without what could hurt them and what stops it. */}
          {hazards.length > 0 ? (
            <div className="mb-4 rounded-md border p-3">
              <h3 className="mb-2 text-sm font-semibold">{t('briefing.hazardsHeading')}</h3>
              <ul className="space-y-2">
                {hazards.map((h) => (
                  <li key={`${h.raVersionId}-${h.index}`} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{h.hazard}</span>
                      <span className="text-muted-foreground text-xs">
                        {t(`band.${h.residualBand}` as never)}
                      </span>
                    </div>
                    {h.whoAffected.length > 0 ? (
                      <p className="text-muted-foreground text-xs">
                        {t('briefing.whoAffected')}: {h.whoAffected}
                      </p>
                    ) : null}
                    {h.controls.length > 0 ? (
                      <p className="mt-0.5 text-sm whitespace-pre-wrap">{h.controls}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {coshh.length > 0 ? (
            <div className="mb-4 rounded-md border p-3">
              <h3 className="mb-2 text-sm font-semibold">{t('briefing.coshhHeading')}</h3>
              <ul className="space-y-1 text-sm">
                {coshh.map((c) => (
                  <li key={c.assessmentId}>
                    <span className="font-medium">{c.substanceName}</span>
                    {c.taskDescription.length > 0 ? (
                      <span className="text-muted-foreground"> — {c.taskDescription}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
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

          {/* RS-A6: the signature. The router has always accepted
              `signatureData` and the PDF has always printed a "Signed"
              column — with no pad, that column was structurally "—" for
              every row, forever, and a briefing register with no
              signatures is not evidence. */}
          {signature === null ? (
            <SignaturePad
              defaultName={name}
              onSave={({ signatureData }) => setSignature(signatureData)}
            />
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <span className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t('briefing.signatureCaptured')}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSignature(null)}>
                {t('briefing.signAgain')}
              </Button>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={name.trim().length === 0}
            onClick={submitOne}
          >
            {t('briefing.confirm')}
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
