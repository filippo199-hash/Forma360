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
 */
import { ShieldCheck } from 'lucide-react';
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

  const utils = trpc.useUtils();
  const list = trpc.rams.reviews.list.useQuery({});
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
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={`/${locale}/rams`}>{t('library.backToRegister')}</Link>
        </Button>
      </header>

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
                      <p className="mb-1 text-sm">{item.label}</p>
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
