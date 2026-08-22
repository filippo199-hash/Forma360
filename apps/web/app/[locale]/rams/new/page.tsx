'use client';

/**
 * Start a RAMS pack.
 *
 * Three motions, all of which exist to avoid a blank page — the whole
 * adoption risk for this module is authoring effort:
 *   1. from a library method statement (pre-fills six to ten sequenced
 *      steps, hold points, emergency block);
 *   2. by cloning a previous pack wholesale — bindings, COSHH,
 *      documents and tailored steps — which is the commonest real
 *      motion ("same as the Riverside job");
 *   3. blank, for the rare job that fits neither.
 *
 * Everything is on one screen: pick a source, fill the job context, and
 * one button lands you in the builder. The library is seeded on first
 * visit if the tenant has never used it, so option 1 is never empty.
 */
import { ArrowRight, Copy, FileStack, FilePlus2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { nextTitleOnTemplatePick } from '../../../../src/lib/rams-title-prefill';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorMessage } from '../../../../src/lib/use-server-error';

type Source = 'library' | 'duplicate' | 'blank';

export default function NewRamsPackPage() {
  const t = useTranslations('rams');
  const resolveServerError = useServerErrorMessage();
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const router = useRouter();
  // RS-A12: the library's "Start pack" arrives with the chosen template in
  // the query string. Reading it here is what stops the selection being
  // silently dropped on a blank picker.
  const searchParams = useSearchParams();
  const preselectedMethodStatementId = searchParams.get('methodStatementId');
  const preselectedPackId = searchParams.get('fromPackId');

  const [source, setSource] = useState<Source>(
    preselectedPackId !== null ? 'duplicate' : 'library',
  );
  const [methodStatementId, setMethodStatementId] = useState<string | null>(
    preselectedMethodStatementId,
  );
  const [fromPackId, setFromPackId] = useState<string | null>(preselectedPackId);
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  // BUG-12 (part B): which prefill currently owns each field. Cleared on
  // any manual edit, so a pick can replace its own earlier prefill but
  // never the user's text. Refs, not state — provenance, not rendering.
  const titleRef = useRef<HTMLInputElement | null>(null);
  const prefilledTitle = useRef<string | null>(null);
  const prefilledClient = useRef<string | null>(null);
  const [siteId, setSiteId] = useState<string>('');
  const [locationText, setLocationText] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [plannedFrom, setPlannedFrom] = useState('');
  const [plannedTo, setPlannedTo] = useState('');

  const utils = trpc.useUtils();
  const templates = trpc.rams.methodStatements.list.useQuery({ templatesOnly: true });
  const previous = trpc.rams.packs.list.useQuery({ limit: 25 });
  const seedLibrary = trpc.rams.methodStatements.seedLibrary.useMutation({
    onSuccess: () => {
      void utils.rams.methodStatements.list.invalidate();
    },
  });

  // Seed the starter library the first time someone opens this screen on
  // an empty tenant, so "start from a template" is never an empty list.
  const templateCount = templates.data?.length;
  useEffect(() => {
    if (templateCount === 0 && !seedLibrary.isPending && seedLibrary.isIdle) {
      seedLibrary.mutate();
    }
  }, [templateCount, seedLibrary]);

  const create = trpc.rams.packs.create.useMutation({
    onSuccess: (result) => {
      router.push(`/${locale}/rams/${result.packId}/build`);
    },
  });

  const canSubmit =
    title.trim().length > 0 &&
    (source === 'blank' ||
      (source === 'library' && methodStatementId !== null) ||
      (source === 'duplicate' && fromPackId !== null));

  function submit(): void {
    create.mutate({
      title: title.trim(),
      clientName: clientName.trim(),
      locationText: locationText.trim(),
      supervisorName: supervisorName.trim(),
      ...(siteId.length > 0 ? { siteId } : {}),
      ...(plannedFrom.length > 0 ? { plannedFrom: new Date(plannedFrom) } : {}),
      ...(plannedTo.length > 0 ? { plannedTo: new Date(plannedTo) } : {}),
      ...(source === 'library' && methodStatementId !== null ? { methodStatementId } : {}),
      ...(source === 'duplicate' && fromPackId !== null ? { fromPackId } : {}),
    });
  }

  const SOURCES: ReadonlyArray<{
    key: Source;
    icon: typeof FileStack;
    label: string;
    hint: string;
  }> = [
    {
      key: 'library',
      icon: FileStack,
      label: t('new.fromLibrary'),
      hint: t('new.fromLibraryHint'),
    },
    {
      key: 'duplicate',
      icon: Copy,
      label: t('new.duplicate'),
      hint: t('new.duplicateHint'),
    },
    { key: 'blank', icon: FilePlus2, label: t('new.blank'), hint: t('new.blankHint') },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-semibold">{t('new.title')}</h1>
      <p className="text-muted-foreground mb-5 text-sm">{t('new.subtitle')}</p>

      <section className="mb-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            const active = source === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSource(s.key)}
                className={`rounded-lg border p-3 text-left transition ${
                  active ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
                }`}
              >
                <Icon className="mb-1 h-5 w-5" aria-hidden />
                <div className="font-medium">{s.label}</div>
                <div className="text-muted-foreground text-xs">{s.hint}</div>
              </button>
            );
          })}
        </div>
      </section>

      {source === 'library' ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <Label className="mb-2 block">{t('new.pickTemplate')}</Label>
            {templates.isPending || seedLibrary.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(templates.data ?? []).map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setMethodStatementId(tpl.id);
                      // BUG-12: this used to read `title` out of the render
                      // closure. A click landing between a keystroke and the
                      // re-render saw the STALE value — usually '' — so the
                      // guard passed and the template name was written over
                      // a title the user was midway through typing, which
                      // then merged with the in-flight keystroke. Packs
                      // shipped named "…Bay 2 to Bay 4Lifting operation…".
                      // The functional form reads the value React actually
                      // holds, so the guard cannot go stale. Part B tracks
                      // prefill provenance so switching tile A → B replaces
                      // an untouched prefill without ever touching typed
                      // text, and selects the prefill so the first
                      // keystroke REPLACES it — no Ctrl-A required.
                      setTitle((prev) => {
                        const next = nextTitleOnTemplatePick(
                          prev,
                          prefilledTitle.current,
                          tpl.title,
                        );
                        prefilledTitle.current = next.prefill;
                        return next.title;
                      });
                      // Deferred past the click's default handling so the
                      // selection survives focus moving off the tile.
                      // Select ONLY when the prefill actually took the
                      // field (the ref holds the applied prefill by rAF
                      // time) — selecting preserved user text would hand
                      // the next keystroke the whole title to destroy,
                      // the exact BUG-12 clobber class.
                      requestAnimationFrame(() => {
                        if (prefilledTitle.current === null) return;
                        titleRef.current?.focus();
                        titleRef.current?.select();
                      });
                    }}
                    className={`rounded-md border p-2 text-left text-sm transition ${
                      methodStatementId === tpl.id
                        ? 'border-foreground bg-muted'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="font-medium">{tpl.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {t('new.stepCount', { count: tpl.stepCount })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {source === 'duplicate' ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <Label className="mb-2 block">{t('new.pickPack')}</Label>
            {previous.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : (previous.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('new.noPreviousPacks')}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(previous.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setFromPackId(p.id);
                      // BUG-12: same prefill-provenance rules as the
                      // template tiles, for both prefilled fields.
                      setTitle((prev) => {
                        const next = nextTitleOnTemplatePick(prev, prefilledTitle.current, p.title);
                        prefilledTitle.current = next.prefill;
                        return next.title;
                      });
                      setClientName((prev) => {
                        const next = nextTitleOnTemplatePick(
                          prev,
                          prefilledClient.current,
                          p.clientName,
                        );
                        prefilledClient.current = next.prefill;
                        return next.title;
                      });
                      // Select only a prefill that took ownership — never
                      // preserved user text (the BUG-12 clobber class).
                      requestAnimationFrame(() => {
                        if (prefilledTitle.current === null) return;
                        titleRef.current?.focus();
                        titleRef.current?.select();
                      });
                    }}
                    className={`rounded-md border p-2 text-left text-sm transition ${
                      fromPackId === p.id ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="font-medium">{p.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {p.referenceNumber ?? ''} · {p.clientName}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 py-4">
          <div>
            <Label htmlFor="rams-title">{t('fields.title')}</Label>
            <Input
              id="rams-title"
              ref={titleRef}
              value={title}
              onChange={(e) => {
                // Any manual edit takes ownership away from the prefill.
                prefilledTitle.current = null;
                setTitle(e.target.value);
              }}
              placeholder={t('fields.titlePlaceholder')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rams-client">{t('fields.client')}</Label>
              <Input
                id="rams-client"
                value={clientName}
                onChange={(e) => {
                  prefilledClient.current = null;
                  setClientName(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fields.site')}</Label>
              <SiteSelector
                value={siteId !== '' ? [siteId] : []}
                onChange={(next) => setSiteId(next[0] ?? '')}
                multiple={false}
                placeholder={t('fields.noSite')}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rams-location">{t('fields.location')}</Label>
            <Textarea
              id="rams-location"
              rows={2}
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="rams-from">{t('fields.plannedFrom')}</Label>
              <Input
                id="rams-from"
                type="date"
                value={plannedFrom}
                onChange={(e) => setPlannedFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rams-to">{t('fields.plannedTo')}</Label>
              <Input
                id="rams-to"
                type="date"
                value={plannedTo}
                onChange={(e) => setPlannedTo(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rams-supervisor">{t('fields.supervisor')}</Label>
              <Input
                id="rams-supervisor"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
              />
            </div>
          </div>

          {create.error !== null ? (
            <p className="text-destructive text-sm">
              {resolveServerError(create.error, t('createFailed'))}
            </p>
          ) : null}

          <Button type="button" disabled={!canSubmit || create.isPending} onClick={submit}>
            {t('new.createAndBuild')}
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
