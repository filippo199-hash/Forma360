'use client';

/**
 * Third-party RAMS review — the receive side.
 *
 * What turns this from a contractor feature into a platform one: a
 * contractor's pack arrives against their record and a named reviewer
 * works a short checklist, accepts with validity dates (or with
 * conditions), or rejects with comments the contractor gets back.
 *
 * List and review workspace on one screen: selecting a row opens its
 * checklist beside the list, so a reviewer working through a queue never
 * loses their place.
 *
 * The intake form (RS-A4) is what feeds it. The decision workspace
 * shipped without one, so `reviews.submit` had no caller and the queue
 * rendered its empty state permanently — an entire half of the module
 * with a UI and no door. A receive-only organisation (estates, an NHS
 * trust) never authors a pack; logging one that arrived by email is
 * their whole interaction with this module.
 */
import { Plus, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  RAMS_REVIEW_CHECKLIST,
  REVIEW_ITEM_VERDICTS,
  type ReviewItemVerdict,
} from '@forma360/shared/rams';
import { ReviewOutcomeChip } from '../../../../src/components/rams/chips';
import { SearchSelect } from '../../../../src/components/selectors/search-select';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Outcome = 'accepted' | 'accepted_with_conditions' | 'rejected';

export default function RamsReviewsPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const canReview = useHasPermission('rams.review');

  const [selected, setSelected] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, ReviewItemVerdict>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome>('accepted');
  const [conditions, setConditions] = useState('');
  const [reviewComments, setReviewComments] = useState('');
  const [validTo, setValidTo] = useState('');

  // RS-A4: intake — "a contractor sent us a pack, log it for review".
  const [showIntake, setShowIntake] = useState(false);
  const [intakeContractor, setIntakeContractor] = useState<string | null>(null);
  const [intakeTitle, setIntakeTitle] = useState('');
  const [intakeWork, setIntakeWork] = useState('');
  const [intakeSite, setIntakeSite] = useState('');
  const [intakeError, setIntakeError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const list = trpc.rams.reviews.list.useQuery({});
  const contractors = trpc.contractors.list.useQuery({ limit: 200 }, { enabled: canReview });
  const detail = trpc.rams.reviews.get.useQuery(
    { reviewId: selected ?? '' },
    { enabled: selected !== null },
  );

  // Load the stored checklist into local state when a review is opened.
  const stored = detail.data?.review.checklist;
  useEffect(() => {
    if (stored === undefined) return;
    const v: Record<string, ReviewItemVerdict> = {};
    const c: Record<string, string> = {};
    for (const entry of stored) {
      v[entry.id] = entry.verdict;
      c[entry.id] = entry.comment;
    }
    setVerdicts(v);
    setComments(c);
  }, [stored]);

  const decide = trpc.rams.reviews.decide.useMutation({
    onSuccess: () => {
      void utils.rams.reviews.list.invalidate();
      void utils.rams.reviews.get.invalidate();
      void utils.rams.packs.overview.invalidate();
    },
  });

  const submitIntake = trpc.rams.reviews.submit.useMutation({
    onSuccess: (result) => {
      setIntakeError(null);
      setShowIntake(false);
      setIntakeContractor(null);
      setIntakeTitle('');
      setIntakeWork('');
      setIntakeSite('');
      void utils.rams.reviews.list.invalidate();
      // Open what was just logged — the reviewer's next move is always
      // to work its checklist.
      setSelected(result.reviewId);
    },
    onError: (err) => setIntakeError(err.message),
  });

  const rows = list.data ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-6 w-6" aria-hidden />
            {t('reviews.title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('reviews.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canReview ? (
            <Button type="button" size="sm" onClick={() => setShowIntake(!showIntake)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('reviews.logReceived')}
            </Button>
          ) : null}
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/${locale}/rams`}>{t('library.backToRegister')}</Link>
          </Button>
        </div>
      </header>

      {/* RS-A4: the intake the decision workspace never had. */}
      {showIntake ? (
        <Card className="mb-4">
          <CardContent className="space-y-3 py-4">
            <div>
              <h2 className="font-semibold">{t('reviews.logReceived')}</h2>
              <p className="text-muted-foreground text-sm">{t('reviews.logReceivedHint')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchSelect
                value={intakeContractor}
                onChange={setIntakeContractor}
                options={(contractors.data?.contractors ?? []).map((c) => ({
                  id: c.id,
                  label: c.name,
                }))}
                label={t('reviews.contractor')}
                placeholder={t('reviews.contractorPlaceholder')}
              />
              <div className="space-y-1.5">
                <Label htmlFor="intake-title">{t('reviews.packTitle')}</Label>
                <Input
                  id="intake-title"
                  value={intakeTitle}
                  onChange={(e) => setIntakeTitle(e.target.value)}
                  placeholder={t('reviews.packTitlePlaceholder')}
                  maxLength={200}
                />
              </div>
            </div>
            <SiteSelector
              value={intakeSite === '' ? [] : [intakeSite]}
              onChange={(next) => setIntakeSite(next[0] ?? '')}
              multiple={false}
              label={t('reviews.site')}
              placeholder={t('reviews.sitePlaceholder')}
            />
            <div className="space-y-1.5">
              <Label htmlFor="intake-work">{t('reviews.workDescription')}</Label>
              <Textarea
                id="intake-work"
                value={intakeWork}
                onChange={(e) => setIntakeWork(e.target.value)}
                placeholder={t('reviews.workDescriptionPlaceholder')}
                rows={2}
              />
            </div>
            {intakeError !== null ? (
              <p className="text-destructive text-sm">{intakeError}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={
                  intakeContractor === null || intakeTitle.trim() === '' || submitIntake.isPending
                }
                onClick={() => {
                  if (intakeContractor === null) return;
                  submitIntake.mutate({
                    contractorId: intakeContractor,
                    title: intakeTitle.trim(),
                    workDescription: intakeWork.trim(),
                    ...(intakeSite !== '' ? { siteId: intakeSite } : {}),
                  });
                }}
              >
                {t('reviews.logAndOpen')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowIntake(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          {list.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">{t('reviews.empty')}</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={`w-full rounded-md border p-3 text-left transition ${
                      selected === r.id ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.title}</span>
                      <ReviewOutcomeChip outcome={r.outcome} />
                      {!r.valid && r.outcome !== 'pending' && r.outcome !== 'rejected' ? (
                        <span className="text-xs text-red-700 dark:text-red-300">
                          {t('reviews.expired')}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-sm">{r.contractorName}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {selected === null ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">{t('reviews.selectPrompt')}</p>
              </CardContent>
            </Card>
          ) : detail.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : detail.error !== null ? (
            <p className="text-destructive">{detail.error.message}</p>
          ) : (
            <Card>
              <CardContent className="space-y-3 py-4">
                <div>
                  <h2 className="font-semibold">{detail.data.review.title}</h2>
                  <p className="text-muted-foreground text-sm">
                    {detail.data.review.workDescription}
                  </p>
                </div>

                <div className="space-y-2">
                  {RAMS_REVIEW_CHECKLIST.map((item) => (
                    <div key={item.id} className="rounded-md border p-2">
                      {/* RS-A13: the constant's own comment said these ids
                          "key the i18n labels" — the indirection was
                          designed and never built, so eight English
                          strings rendered inside a localised page. */}
                      <p className="mb-1 text-sm">{t(`reviewChecklist.${item.id}` as never)}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {REVIEW_ITEM_VERDICTS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            disabled={!canReview}
                            onClick={() => setVerdicts((prev) => ({ ...prev, [item.id]: v }))}
                            className={`rounded-full border px-2.5 py-0.5 text-xs ${
                              verdicts[item.id] === v
                                ? 'bg-foreground text-background'
                                : 'hover:bg-muted'
                            }`}
                          >
                            {t(`reviewVerdict.${v}`)}
                          </button>
                        ))}
                      </div>
                      {verdicts[item.id] === 'fail' ? (
                        <Input
                          className="mt-1"
                          placeholder={t('reviews.itemComment')}
                          value={comments[item.id] ?? ''}
                          onChange={(e) =>
                            setComments((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                </div>

                {canReview ? (
                  <div className="space-y-3 border-t pt-3">
                    <div>
                      <Label htmlFor="outcome">{t('reviews.outcome')}</Label>
                      <select
                        id="outcome"
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value as Outcome)}
                        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                      >
                        <option value="accepted">{t('reviewOutcome.accepted')}</option>
                        <option value="accepted_with_conditions">
                          {t('reviewOutcome.accepted_with_conditions')}
                        </option>
                        <option value="rejected">{t('reviewOutcome.rejected')}</option>
                      </select>
                    </div>

                    {outcome === 'accepted_with_conditions' ? (
                      <div>
                        <Label htmlFor="conditions">{t('reviews.conditions')}</Label>
                        <Textarea
                          id="conditions"
                          rows={2}
                          value={conditions}
                          onChange={(e) => setConditions(e.target.value)}
                        />
                      </div>
                    ) : null}

                    {outcome === 'rejected' ? (
                      <div>
                        <Label htmlFor="review-comments">{t('reviews.comments')}</Label>
                        <Textarea
                          id="review-comments"
                          rows={2}
                          value={reviewComments}
                          onChange={(e) => setReviewComments(e.target.value)}
                        />
                      </div>
                    ) : null}

                    {outcome !== 'rejected' ? (
                      <div>
                        <Label htmlFor="valid-to">{t('reviews.validTo')}</Label>
                        <Input
                          id="valid-to"
                          type="date"
                          value={validTo}
                          onChange={(e) => setValidTo(e.target.value)}
                        />
                      </div>
                    ) : null}

                    {decide.error !== null ? (
                      <p className="text-destructive text-sm">{decide.error.message}</p>
                    ) : null}

                    <Button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          reviewId: selected,
                          checklist: RAMS_REVIEW_CHECKLIST.map((item) => ({
                            id: item.id,
                            verdict: verdicts[item.id] ?? 'na',
                            comment: comments[item.id] ?? '',
                          })),
                          outcome,
                          conditions,
                          comments: reviewComments,
                          ...(outcome !== 'rejected' && validTo.length > 0
                            ? { validTo: new Date(validTo) }
                            : {}),
                        })
                      }
                    >
                      {t('reviews.recordDecision')}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
