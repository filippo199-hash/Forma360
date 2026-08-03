'use client';

/**
 * Point-of-work COSHH check (C-6) — the at-the-task mobile flow.
 *
 * Pick the product → confirm the task, routes and today's controls →
 * sign and publish → share (with the SDS attached). Controls from the
 * substance's latest assessment are carried in pre-ticked so the
 * operative confirms instead of retyping; the same publish guards as the
 * desktop editor apply (routes, ≥1 control, PPE-only justification, CMR
 * substitution-first).
 */
import { AlertTriangle, CheckCircle2, ChevronRight, FileText, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PictogramChips, SdsStatusChip } from '../../../../src/components/coshh/chips';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { enqueueOffline, isNetworkError } from '../../../../src/lib/offline-queue';
import { newId } from '@forma360/shared/id';
import { trpc } from '../../../../src/lib/trpc/client';

const TIERS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'rpe',
  'ppe',
] as const;
type Tier = (typeof TIERS)[number];

const PUBLISH_ERRORS = new Set([
  'no-routes',
  'no-controls',
  'ppe-only-needs-justification',
  'substitution-not-considered',
  'archived',
]);

interface PickedControl {
  key: string;
  tier: Tier;
  description: string;
  rpeType: string | null;
  rpeApf: number | null;
  faceFitConfirmedAt: Date | null;
}

export default function PointOfWorkPage() {
  const t = useTranslations('coshh.pow');
  const tCoshh = useTranslations('coshh');
  const tEditor = useTranslations('coshh.editor');
  const tCommon = useTranslations('common');
  const tOffline = useTranslations('offline');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [task, setTask] = useState('');
  const [routes, setRoutes] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [addedText, setAddedText] = useState('');
  const [addedTier, setAddedTier] = useState<Tier>('administrative');
  const [added, setAdded] = useState<PickedControl[]>([]);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ assessmentId: string; referenceNumber: string } | null>(null);

  // ?substanceId= lands straight on the form (linked from the substance page).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const pre = sp.get('substanceId');
    if (pre !== null && pre.length === 26) setSelectedId(pre);
  }, []);

  const list = trpc.coshh.substances.list.useQuery(
    { status: 'active', ...(search.trim() !== '' ? { search: search.trim() } : {}) },
    { enabled: selectedId === '' },
  );
  const detail = trpc.coshh.substances.get.useQuery(
    { substanceId: selectedId },
    { enabled: selectedId !== '' },
  );
  const presets = trpc.coshh.presets.useQuery();

  const createAssessment = trpc.coshh.assessments.create.useMutation();
  const updateAssessment = trpc.coshh.assessments.update.useMutation();
  const addControl = trpc.coshh.assessments.addControl.useMutation();
  const publish = trpc.coshh.assessments.publish.useMutation();

  const substance = detail.data?.substance;
  const currentSds = detail.data?.sdsDocuments.find((d) => d.isCurrent) ?? null;
  // Latest assessment's controls, carried in pre-ticked.
  const carried = useMemo<PickedControl[]>(() => {
    const latest = detail.data?.assessments[0];
    return (latest?.controls ?? []).map((c) => ({
      key: c.id,
      tier: TIERS.includes(c.tier as Tier) ? (c.tier as Tier) : 'administrative',
      description: c.description,
      rpeType: c.rpeType,
      rpeApf: c.rpeApf,
      faceFitConfirmedAt: c.faceFitConfirmedAt,
    }));
  }, [detail.data]);
  // Tick everything carried by default, once per substance selection.
  useEffect(() => {
    setTicked(new Set(carried.map((c) => c.key)));
  }, [carried]);

  const selectedControls = [...carried.filter((c) => ticked.has(c.key)), ...added];
  const allPpe =
    selectedControls.length > 0 && selectedControls.every((c) => c.tier === 'rpe' || c.tier === 'ppe');
  const cmrBlocked =
    substance !== undefined &&
    (substance.isCarcinogen || substance.isMutagen) &&
    substance.substitutionStatus === 'not_assessed';
  const ready =
    task.trim() !== '' &&
    routes.length > 0 &&
    selectedControls.length > 0 &&
    (!allPpe || justification.trim() !== '') &&
    !cmrBlocked;

  function toggleRoute(r: string): void {
    setRoutes((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function addExtraControl(): void {
    const text = addedText.trim();
    if (text === '') return;
    setAdded((prev) => [
      ...prev,
      {
        key: `new-${prev.length}-${text}`,
        tier: addedTier,
        description: text,
        rpeType: null,
        rpeApf: null,
        faceFitConfirmedAt: null,
      },
    ]);
    setAddedText('');
  }

  async function submit(): Promise<void> {
    if (busy || !ready || substance === undefined) return;
    setBusy(true);
    // PF-10: one id per submit attempt — the server dedupes the create on
    // it, so an offline-queued replay can never double-create.
    const clientRequestId = newId();
    try {
      const created = await createAssessment.mutateAsync({
        substanceId: substance.id,
        taskDescription: task.trim(),
        kind: 'point_of_work',
        clientRequestId,
      });
      await updateAssessment.mutateAsync({
        assessmentId: created.assessmentId,
        // Chips only offer catalogue routes, so the cast is safe.
        routesOfExposure: routes as never,
      });
      let justified = false;
      for (const c of selectedControls) {
        const needJust = allPpe && !justified;
        await addControl.mutateAsync({
          assessmentId: created.assessmentId,
          tier: c.tier,
          description: c.description,
          status: 'in_place',
          ...(needJust ? { ppeJustification: justification.trim() } : {}),
          ...(c.rpeType !== null ? { rpeType: c.rpeType } : {}),
          ...(c.rpeApf !== null ? { rpeApf: c.rpeApf } : {}),
          ...(c.faceFitConfirmedAt !== null ? { faceFitConfirmedAt: c.faceFitConfirmedAt } : {}),
        });
        if (needJust) justified = true;
      }
      await publish.mutateAsync({ assessmentId: created.assessmentId });
      setDone(created);
    } catch (err) {
      // PF-10: at-the-task assessments happen exactly where signal dies.
      // Connectivity failure → queue the whole intent (create + routes +
      // controls + publish); the flusher replays it when back online.
      if (isNetworkError(err)) {
        enqueueOffline('coshh-pow', {
          create: {
            substanceId: substance.id,
            taskDescription: task.trim(),
            kind: 'point_of_work',
            clientRequestId,
          },
          routesOfExposure: routes,
          controls: selectedControls.map((c, i) => ({
            tier: c.tier,
            description: c.description,
            status: 'in_place',
            ...(allPpe && i === 0 ? { ppeJustification: justification.trim() } : {}),
            ...(c.rpeType !== null ? { rpeType: c.rpeType } : {}),
            ...(c.rpeApf !== null ? { rpeApf: c.rpeApf } : {}),
            ...(c.faceFitConfirmedAt !== null ? { faceFitConfirmedAt: c.faceFitConfirmedAt } : {}),
          })),
        });
        toast.success(tOffline('queuedToast'));
        setBusy(false);
        return;
      }
      const message = err instanceof Error ? err.message : '';
      const key = PUBLISH_ERRORS.has(message) ? message : 'generic';
      toast.error(tEditor(`publishErrors.${key}` as never));
    } finally {
      setBusy(false);
    }
  }

  function shareViaHeadsUp(): void {
    if (substance === undefined || done === null) return;
    const shareTitle = `${substance.name} — ${done.referenceNumber}`;
    const link = `${window.location.origin}/${locale}/coshh/${substance.id}/assessments/${done.assessmentId}`;
    const description = `${tCoshh('share.description')}\n\n${task.trim()}\n${link}`;
    const att =
      currentSds !== null
        ? `&attKey=${encodeURIComponent(currentSds.storageKey)}` +
          `&attName=${encodeURIComponent(currentSds.filename)}` +
          `&attSize=${currentSds.sizeBytes}` +
          `&attMime=${encodeURIComponent(currentSds.mimeType)}`
        : '';
    router.push(
      `/${locale}/heads-up/new?title=${encodeURIComponent(shareTitle)}&description=${encodeURIComponent(description)}${att}`,
    );
  }

  function reset(): void {
    setSelectedId('');
    setTask('');
    setRoutes([]);
    setAdded([]);
    setJustification('');
    setDone(null);
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/coshh`} width="form">
      {done !== null && substance !== undefined ? (
        /* ── Done ─────────────────────────────────────────────────── */
        <Card className="mx-auto max-w-md">
          <CardContent className="space-y-4 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div>
              <p className="text-lg font-semibold">{t('doneTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('doneRef', { ref: done.referenceNumber, name: substance.name })}
              </p>
            </div>
            <div className="space-y-2">
              <Button className="w-full" onClick={shareViaHeadsUp}>
                {tCoshh('share.button')}
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/${locale}/coshh/${substance.id}/assessments/${done.assessmentId}`}>
                  {t('openButton')}
                </Link>
              </Button>
              <Button variant="ghost" className="w-full" onClick={reset}>
                {t('newCheckButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : selectedId === '' ? (
        /* ── Pick the product ─────────────────────────────────────── */
        <div className="mx-auto max-w-md space-y-3">
          <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-11 pl-8"
            />
          </div>
          <div className="overflow-hidden rounded-md border">
            {(list.data ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {list.isLoading ? tCommon('loading') : t('noResults')}
              </p>
            ) : (
              <ul className="divide-y">
                {(list.data ?? []).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {s.referenceNumber}
                          {s.supplier !== '' ? ` · ${s.supplier}` : ''}
                        </p>
                      </div>
                      <SdsStatusChip status={s.sdsStatus} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : substance === undefined ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : (
        /* ── Confirm task, routes, controls → sign & publish ─────── */
        <div className="mx-auto max-w-md space-y-4">
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{substance.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {substance.referenceNumber}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={reset}>
                  {t('changeSubstance')}
                </Button>
              </div>
              <PictogramChips codes={substance.pictograms} />
              {currentSds !== null ? (
                <a
                  href={`/api/files?key=${encodeURIComponent(currentSds.storageKey)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  {t('sdsLink')}
                </a>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('noSds')}
                </p>
              )}
            </CardContent>
          </Card>

          {cmrBlocked ? (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0">
                {t('cmrBlocked')}{' '}
                <Link href={`/${locale}/coshh/${substance.id}`} className="underline">
                  {t('cmrBlockedLink')}
                </Link>
              </p>
            </div>
          ) : null}

          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="pow-task">{t('taskLabel')}</Label>
                <Textarea
                  id="pow-task"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={2}
                  placeholder={t('taskPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('routesLabel')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(presets.data?.exposureRoutes ?? []).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRoute(r)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        routes.includes(r)
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'hover:bg-accent'
                      }`}
                    >
                      {tCoshh(`routes.${r}` as never)}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="text-sm font-semibold">{t('controlsTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {carried.length > 0 ? t('controlsCarriedHint') : t('controlsEmptyHint')}
                </p>
              </div>
              {carried.length > 0 ? (
                <ul className="space-y-1.5">
                  {carried.map((c) => (
                    <li key={c.key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                        <input
                          type="checkbox"
                          checked={ticked.has(c.key)}
                          onChange={() =>
                            setTicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.key)) next.delete(c.key);
                              else next.add(c.key);
                              return next;
                            })
                          }
                          className="mt-0.5 h-4 w-4"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {tCoshh(`tiers.${c.tier}` as never)}
                          </span>
                          {c.description}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
              {added.map((c, i) => (
                <p key={c.key} className="flex items-center gap-2 px-1 text-sm">
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {tCoshh(`tiers.${c.tier}` as never)}
                  </span>
                  <span className="min-w-0 flex-1">{c.description}</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setAdded((prev) => prev.filter((_, j) => j !== i))}
                  >
                    {t('removeAdded')}
                  </button>
                </p>
              ))}
              <div className="flex gap-2">
                <select
                  aria-label={t('tierLabel')}
                  value={addedTier}
                  onChange={(e) =>
                    setAddedTier(TIERS.includes(e.target.value as Tier) ? (e.target.value as Tier) : 'administrative')
                  }
                  className="rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  {TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {tCoshh(`tiers.${tier}` as never)}
                    </option>
                  ))}
                </select>
                <Input
                  value={addedText}
                  onChange={(e) => setAddedText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExtraControl();
                    }
                  }}
                  placeholder={t('addControlPlaceholder')}
                  className="h-9"
                />
                <Button variant="outline" size="sm" className="h-9" onClick={addExtraControl}>
                  {t('addButton')}
                </Button>
              </div>
              {allPpe ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pow-just" className="text-amber-700 dark:text-amber-300">
                    {t('justificationLabel')}
                  </Label>
                  <Textarea
                    id="pow-just"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={2}
                    placeholder={tEditor('justificationPlaceholder')}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">{tEditor('signOff.statement')}</p>
              <Button className="h-11 w-full" disabled={!ready || busy} onClick={() => void submit()}>
                {busy ? t('publishing') : t('signPublishButton')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </FocusedPageShell>
  );
}
